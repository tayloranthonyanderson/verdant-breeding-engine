## app.R — Breeding Analysis Engine (Phase 0 slice)
## Upload a trial -> correct mixed-model BLUPs/BLUEs, heritability, and a live
## selection-index ranking. Run with:  shiny::runApp("app.R")  (or click Run App)

suppressWarnings(suppressMessages(library(shiny)))
source("R/engine.R")
source("R/selection_index.R")
source("R/simulate.R")

`%||%` <- function(a, b) if (is.null(a)) b else a

# default trait directions for the demo tomato traits (higher/lower = better)
default_dir <- c(yield = 1, brix = 1, fruit_wt = 1, maturity = -1)  # earlier maturity better

ui <- fluidPage(
  titlePanel("Breeding Analysis Engine — MVP slice"),
  sidebarLayout(
    sidebarPanel(
      width = 4,
      h4("1. Data"),
      fileInput("file", "Upload trial CSV", accept = ".csv"),
      actionButton("demo", "Use synthetic tomato demo", class = "btn-info"),
      hr(),
      h4("2. Columns"),
      uiOutput("col_geno"), uiOutput("col_env"), uiOutput("col_block"),
      uiOutput("col_traits"),
      hr(),
      h4("3. Model"),
      radioButtons("geffect", "Genotype effect",
                   c("Random (BLUPs, for selection)" = "random",
                     "Fixed (BLUEs, for comparison)" = "fixed")),
      radioButtons("engine", "Engine",
                   c("lme4 (default)" = "lme4", "rrBLUP (two-step)" = "rrblup")),
      actionButton("run", "Analyze", class = "btn-primary", width = "100%")
    ),
    mainPanel(
      width = 8,
      tabsetPanel(
        tabPanel("Data & checks", verbatimTextOutput("checks"), tableOutput("preview")),
        tabPanel("Model results",
                 h4("Per-trait variance components & heritability"),
                 tableOutput("varcomp"),
                 h4("Genotype values"), tableOutput("effects")),
        tabPanel("Selection index",
                 uiOutput("weight_ui"),
                 h4("Ranked selections"), tableOutput("index"),
                 plotOutput("index_plot", height = "300px")),
        tabPanel("Engine notes", verbatimTextOutput("notes"))
      )
    )
  )
)

server <- function(input, output, session) {
  rv <- reactiveValues(data = NULL, fits = NULL)

  load_data <- function(df) {
    rv$data <- df
    cols <- names(df)
    guess <- function(opts) { hit <- opts[opts %in% cols]; if (length(hit)) hit[1] else cols[1] }
    output$col_geno   <- renderUI(selectInput("geno", "Genotype", cols, guess(c("genotype","geno","entry","line"))))
    output$col_env     <- renderUI(selectInput("env", "Environment (optional)", c("(none)", cols),
                                               guess(c("env","environment","site","location"))))
    output$col_block   <- renderUI(selectInput("block", "Block/Rep (optional)", c("(none)", cols),
                                               guess(c("block","rep","replicate"))))
    numeric_cols <- cols[sapply(df, is.numeric)]
    output$col_traits <- renderUI(checkboxGroupInput("traits", "Traits to analyze",
                                                     numeric_cols, selected = numeric_cols[1:min(4, length(numeric_cols))]))
  }

  observeEvent(input$demo, load_data(simulate_tomato_met()))
  observeEvent(input$file, {
    req(input$file)
    load_data(read.csv(input$file$datapath, stringsAsFactors = FALSE))
  })

  output$preview <- renderTable(head(rv$data, 8))
  output$checks <- renderText({
    df <- rv$data; if (is.null(df)) return("Load data (upload a CSV or click the demo button).")
    paste0("Rows: ", nrow(df), "   Columns: ", ncol(df),
           "\nColumns: ", paste(names(df), collapse = ", "),
           "\nMissing cells: ", sum(is.na(df)))
  })

  observeEvent(input$run, {
    req(rv$data, input$geno, input$traits)
    env   <- if (identical(input$env, "(none)")) NULL else input$env
    block <- if (identical(input$block, "(none)")) NULL else input$block
    withProgress(message = "Fitting models", value = 0, {
      fits <- list()
      for (tr in input$traits) {
        incProgress(1 / length(input$traits), detail = tr)
        fits[[tr]] <- tryCatch(
          fit_genotype_values(rv$data, tr, genotype = input$geno, env = env,
                              block = block, genotype_effect = input$geffect, engine = input$engine),
          error = function(e) structure(list(error = conditionMessage(e)), class = "fit_error"))
      }
      rv$fits <- fits
    })
  })

  ok_fits <- reactive({ Filter(function(f) is.null(f$error), rv$fits %||% list()) })

  output$varcomp <- renderTable({
    f <- ok_fits(); req(length(f) > 0)
    do.call(rbind, lapply(names(f), function(tr) {
      vc <- f[[tr]]$varcomp
      data.frame(trait = tr, component = vc$component, variance = round(vc$variance, 4),
                 heritability = ifelse(vc$component == vc$component[1], round(f[[tr]]$heritability, 3), NA))
    }))
  })

  output$effects <- renderTable({
    f <- ok_fits(); req(length(f) > 0)
    tab <- Reduce(function(a, b) merge(a, b, by = "genotype", all = TRUE),
                  lapply(names(f), function(tr) {
                    d <- f[[tr]]$effects[, c("genotype", "value")]; names(d)[2] <- tr; d }))
    head(tab[order(tab$genotype), ], 20)
  })

  output$weight_ui <- renderUI({
    f <- ok_fits(); req(length(f) > 0)
    tagList(lapply(names(f), function(tr) {
      fluidRow(
        column(6, sliderInput(paste0("w_", tr), paste("Weight:", tr), 0, 3, 1, 0.25)),
        column(6, radioButtons(paste0("d_", tr), paste("Direction:", tr),
                               c("Higher better" = "1", "Lower better" = "-1"),
                               selected = as.character(ifelse(!is.na(default_dir[tr]), default_dir[tr], 1)),
                               inline = TRUE)))
    }))
  })

  index_tab <- reactive({
    f <- ok_fits(); req(length(f) > 0)
    eff <- lapply(f, function(x) x$effects)
    w <- sapply(names(f), function(tr) input[[paste0("w_", tr)]] %||% 1)
    d <- sapply(names(f), function(tr) as.numeric(input[[paste0("d_", tr)]] %||% 1))
    names(w) <- names(d) <- names(f)
    build_selection_index(eff, w, d)
  })

  output$index <- renderTable(head(index_tab(), 20))
  output$index_plot <- renderPlot({
    tab <- head(index_tab(), 20)
    op <- par(mar = c(8, 4, 1, 1)); on.exit(par(op))
    barplot(tab$index, names.arg = tab$genotype, las = 2,
            ylab = "Selection index", col = "steelblue", cex.names = 0.7)
  })

  output$notes <- renderText({
    f <- rv$fits; if (is.null(f)) return("Run an analysis to see engine notes.")
    lines <- sapply(names(f), function(tr) {
      x <- f[[tr]]
      if (!is.null(x$error)) return(paste0(tr, ": ERROR - ", x$error))
      paste0(tr, ": engine=", x$engine, ", h2=", round(x$heritability, 3),
             if (length(x$warnings)) paste0("  [warnings: ", paste(x$warnings, collapse = "; "), "]") else "")
    })
    paste(lines, collapse = "\n")
  })
}

shinyApp(ui, server)
