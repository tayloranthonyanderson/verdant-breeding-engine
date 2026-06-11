#!/usr/bin/env Rscript
## entrypoint.R — start the breeding API. Run from the project root.
##   Rscript api/entrypoint.R
suppressWarnings(suppressMessages(library(plumber)))

setwd(Sys.getenv("APP_ROOT", "."))
port <- as.integer(Sys.getenv("PORT", "8000"))

pr <- plumb("api/plumber.R")
pr <- pr_set_serializer(pr, serializer_unboxed_json(na = "null"))
cat(sprintf("Breeding API listening on http://0.0.0.0:%d\n", port))
pr_run(pr, host = "0.0.0.0", port = port)
