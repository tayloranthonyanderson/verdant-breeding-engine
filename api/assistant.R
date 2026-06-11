## assistant.R — embedded AI assistant: tool-constrained Claude over a result bundle.
##
## The model may ONLY call the deterministic ops in the engine's ai_dispatch().
## It never sees raw plot data and never computes a statistic — every number in
## its answer traces back to a tool result. Anti-fabrication by construction.

suppressWarnings(suppressMessages({ library(httr2) }))

`%||%` <- function(a, b) if (is.null(a)) b else a

claude_model <- function() Sys.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

# Empty JSON object for no-arg tool schemas.
.empty_obj <- structure(list(), names = character(0))

.assistant_tools <- function() list(
  list(name = "summarize",
       description = "Overview of the analysis: traits, genotype count, heritabilities, engine.",
       input_schema = list(type = "object", properties = .empty_obj)),
  list(name = "rank_by_trait",
       description = "Top genotypes by one trait's estimated value (BLUP/BLUE).",
       input_schema = list(type = "object",
         properties = list(trait = list(type = "string"),
                           n = list(type = "integer", description = "how many (default 10)")),
         required = list("trait"))),
  list(name = "top_selections",
       description = "Top genotypes by the overall multi-trait selection index.",
       input_schema = list(type = "object",
         properties = list(n = list(type = "integer", description = "how many (default 10)")))),
  list(name = "compare_genotypes",
       description = "Compare specific named genotypes across all traits and the index.",
       input_schema = list(type = "object",
         properties = list(genotypes = list(type = "array", items = list(type = "string"))),
         required = list("genotypes"))),
  list(name = "describe_model",
       description = "Explain how the model and selection index were computed.",
       input_schema = list(type = "object", properties = .empty_obj))
)

SYSTEM_PROMPT <- paste(
  "You are an assistant embedded in a plant-breeding analytics platform.",
  "A statistical analysis (mixed-model BLUPs/BLUEs, heritability, a selection index) has ALREADY",
  "been computed for the breeder's trial. You can ONLY answer by calling the provided tools, which",
  "query that computed analysis. NEVER state a numeric value that did not come from a tool result.",
  "If the tools cannot answer, say so plainly. Be concise and speak the breeder's language.")

#' Run one assistant turn over a result bundle.
#' @return list(reply, tool_calls, configured)
assistant_reply <- function(bundle, message, history = list()) {
  key <- Sys.getenv("ANTHROPIC_API_KEY", "")
  if (!nzchar(key))
    return(list(reply = paste("The AI assistant needs ANTHROPIC_API_KEY configured to chat.",
                              "Your full analysis is available in the results panel."),
                tool_calls = list(), configured = FALSE))

  msgs <- history
  msgs[[length(msgs) + 1]] <- list(role = "user", content = message)
  tools <- .assistant_tools()
  used <- list()

  for (iter in 1:6) {
    body <- list(model = claude_model(), max_tokens = 1024,
                 system = SYSTEM_PROMPT, tools = tools, messages = msgs)
    raw <- jsonlite::toJSON(body, auto_unbox = TRUE, null = "null")
    resp <- request("https://api.anthropic.com/v1/messages") |>
      req_headers(`x-api-key` = key, `anthropic-version` = "2023-06-01",
                  `content-type` = "application/json") |>
      req_body_raw(raw, type = "application/json") |>
      req_error(is_error = function(r) FALSE) |>
      req_perform()
    if (resp_status(resp) >= 400)
      return(list(reply = paste("Assistant error:", resp_body_string(resp)),
                  tool_calls = used, configured = TRUE))
    out <- resp_body_json(resp)

    msgs[[length(msgs) + 1]] <- list(role = "assistant", content = out$content)
    tool_uses <- Filter(function(b) identical(b$type, "tool_use"), out$content)

    if (length(tool_uses) == 0) {
      txt <- paste(vapply(Filter(function(b) identical(b$type, "text"), out$content),
                          function(b) b$text %||% "", character(1)), collapse = "\n")
      return(list(reply = txt, tool_calls = used, configured = TRUE))
    }

    results <- lapply(tool_uses, function(tu) {
      args <- tu$input %||% list()
      val <- tryCatch(
        jsonlite::toJSON(ai_dispatch(bundle, tu$name, args), auto_unbox = TRUE, na = "null"),
        error = function(e) jsonlite::toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
      used[[length(used) + 1]] <<- list(tool = tu$name, args = args)
      list(type = "tool_result", tool_use_id = tu$id, content = as.character(val))
    })
    msgs[[length(msgs) + 1]] <- list(role = "user", content = results)
  }
  list(reply = "(The assistant took too many steps without finishing.)",
       tool_calls = used, configured = TRUE)
}
