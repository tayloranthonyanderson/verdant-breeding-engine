# Product Brief — *(working name: TBD)*

> A web-native, AI-forward breeding analytics engine for the small and mid-size
> breeding programs the incumbents price out and over-complicate.

## The one-liner
Upload your trial data, get the right answer — correct mixed-model BLUPs,
heritabilities, and a ranked selection index — without needing a statistician on
staff. Then ask your data questions in plain English.

## The problem
Small breeding programs (specialty crops, CEA, seed startups, university and
overseas programs) have data but no PhD breeder to:
- design sound trials,
- fit the *correct* linear mixed model (most get fixed/random effects wrong),
- compute selection indices and interpret GxE/stability,
- and increasingly, run genomic prediction.

The existing tools (Integrated Breeding Platform/BMS, EBS, Phenome, and stats
engines like ASReml) are expensive, desktop-era, siloed, and assume the user
already has statistical expertise. That assumption is the opening.

## Target user (beachhead)
**Tomato breeders outside the big-company orbit** — fresh-market, heirloom,
specialty, organic, and CEA tomato programs — then adjacent vegetable programs.
Tomato-first because of the owner's domain depth and a ready demo genome set.

## The moat
Not a dataset (public data is reproducible by anyone). The defensibility is:
1. **Breeder expertise compiled into software** — the engine makes the *correct*
   statistical/modeling choices a small program can't make itself. Hard to copy
   because it takes a breeder, not a developer.
2. **A clean orchestration/UX layer over battle-tested solvers**
   (lme4 → rrBLUP two-step → BLUPF90) that small programs can't assemble or
   afford to operate.
3. **Founder-led distribution** — the owner teaching the product on video;
   incumbents can't manufacture that.

**Demo asset (not a moat):** a privately funded, IP-clean library of hundreds of
variant-called tomato whole genomes (public data + owner's own money) — useful
for compelling demo insights and genomic-prediction showcases, not defensible.

## MVP (the first vertical slice)
**Analysis engine:** trial/phenotype data in → BLUPs/BLUEs, heritability,
ranked selection index out, with interactive trait weighting. Everything else
is roadmap, not v1.

## Why it wins vs. incumbents
- **Web-native, per-seat SaaS** vs. installed licenses.
- **Automated statistical pipeline** — picks and fits the right model so the
  user doesn't have to know what a BLUP is.
- **Natural-language layer** over results — structurally hard for incumbents to
  retrofit; native for us.
- **Genomic prediction built in** for tomato via the variant library.
- **A founder who can teach it** — distribution via content/video, not just sales.

## Business model
Per-seat SaaS; license the engine to small breeding companies and programs.
Tiered: analysis-only → + genomics → + team/data management.

## Hard constraints (non-negotiable)
- **No employer germplasm, data, or IP, ever.** Public + self-funded data only.
- Built in 8–12 hrs/week (with occasional binges); favor lean, explainable tech.
- Owner is strong in R, some Python, learning — stack must stay legible to him.
