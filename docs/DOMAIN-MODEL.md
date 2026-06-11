# Verdant — Breeding Domain Model

The stable backbone the incremental build implements against (ADR-0010). Maps the whole
breeding lifecycle and defines the canonical data model so features *attach* to a coherent
structure instead of accreting.

**Discipline — map the territory, lay track only where we drive.** Conceptually complete;
**implemented schema** committed only for what the current milestone(s) touch. Everything
else is *mapped, not built* — present so the seams anticipate it, absent from the database
until needed.

**Status:** v0.2 (2026-06-11) — refined through grilling with the founder. Grounded in
BrAPI v2, the standard QG/breeding texts, and Breedbase's schema. Vocabulary feeds
[CONTEXT.md](../CONTEXT.md); decisions feed [ADRs](adr/).

---

## 1. Organizing principle: the breeder's equation

A breeding program is a recurrent loop that improves a population over cycles. Every
capability moves one term of the response-to-selection equation (Falconer & Mackay; Bernardo):

```
        i · r · σ_A
  ΔG = ─────────────        genetic gain per unit time
             L
```

| Term | Meaning | Platform levers |
|---|---|---|
| **r** — accuracy | corr(estimated, true breeding value) | correct mixed models, spatial correction, MET/GxE, heritability, genomic prediction ← **analysis moat** |
| **i** — intensity | selection sharpness | selection index, stage-gate selection fractions |
| **σ_A** — variation | useful additive variance | germplasm/diversity management, **list/pool-building**, mating designs |
| **L** — cycle time | years/cycle | genomic selection, speed breeding, trial/logistics efficiency |

σ_A maintenance is not passive: it's the breeder's standing job to keep enough useful
diversity (effective population size) to sustain gain over cycles while still concentrating
elite material. List/pool-building (§5) operationalizes this.

The commercial objective is really **ΔG per dollar** — gain under budget and operational
constraints. Maximizing it is a constrained-optimization problem over this whole equation; the
**decision-support layer** (optimization + simulation; ADR-0011) is where we tackle it
(mapped, not built).

---

## 2. The two organizing axes

Material and work are organized along **two independent, program-defined axes**. These are
the backbone of the data model.

### 2.1 Stage — pipeline maturity (ordinal)
- A candidate's position on the program's **ordered advancement ladder** (e.g.
  nursery → stage 1 → stage 2 → pre-commercial → commercial). **Program-defined and ordered.**
- Material moves between stages via an **AdvancementDecision** (§4).
- **Terminology:** R&D/breeders say *stage*; commercial teams say *phase*. This is R&D-focused
  software → canonical term is **Stage**; *phase* is recorded as the commercial-side synonym.
  Not to be confused with growth/phenological stage.

### 2.2 Market / Segment — commercial target (faceted, flexible, time-variant)
- **Program-defined** commercial targets, grouped by whatever they share — **mechanization,
  season, climate (humid/arid), rainfall, soil**. There is **no single defining axis**; the
  grouping is business strategy and **changes over time** → segments are **effective-dated**,
  modeled as faceted/attributed entities, not a rigid hierarchy.
- Each Segment carries a **Target Product Profile (TPP)** — trait targets, directions, weights —
  which drives a **market-specific selection index**. The *same trial data*, scored under
  different segment TPPs, yields *different rankings and decisions*.
- **Multi-valued / efficiency:** a candidate can serve many segments; advancement is recorded
  **per candidate × segment** (a line can be advanced for fresh-market and dropped for
  processing). Surfacing multi-segment candidates is a first-class feature.
- **Discovery isolation (statistical, not administrative):** a trial whose intent is *discovery*
  (no commercial segment, or unadapted-screening) is naturally excluded from any segment
  pipeline's prediction training data. Market intent is the principled basis for **scoping the
  data that feeds a prediction** — protecting training-set relevance and avoiding variance
  distortion from exotic material (Bernardo; GS training-set literature).

### 2.3 Stage × Market interaction
Advancement is per candidate × Segment, so **Stage is per (candidate × Segment)** — a real,
common case (e.g. a line one year from commercialization in the US but two years in Nicaragua).
"Current stage" is only meaningful relative to a Segment; a candidate's stage in a segment is
the latest AdvancementDecision for that pair. This also carries a **commercialization-timeline**
dimension per market (years-to-commercialization), relevant to product-supply planning.

### 2.4 Selection criteria: gates + index, per (Segment × Stage)
Selection is **gates + index**, not a single index:
- **Gates** — independent culling on must-have traits (disease package, fruit type, color…); fail
  and you're out regardless of index.
- **Index** — directions + weights (transparent + Smith–Hazel, ADR-0006) on survivors' quantitative
  traits.

Both are functions of **(Segment × Stage)**, not Segment alone:
- **Gates tighten with stage.** Early stages keep gates loose/few to **preserve diversity** — an
  early inbred's value is its *combining potential* (it will be recombined into hybrids that meet the
  concept), not standalone product-readiness; applying near-commercial gates to an early inbred would
  discard useful material. Gates converge to the full product requirement near commercial status.
- **Index composition grows with stage**, driven by **measurement economics** — cheap traits screened
  on many entries early; expensive traits (e.g. yield) added on few entries near commercialization.
  An index can only use traits measured at that stage.

So: a **Segment** owns a **TPP** = the commercial-target definition (full gates + full trait priorities;
the north star). Each **(Segment × Stage)** owns a **SelectionCriteria** = the *operational* {gates, index}
applied at that stage, a stage-appropriate realization of the TPP that converges to it as stage advances.
(Whether early-stage evaluation is on *combining ability* vs *per-se* performance is
reproductive-biology-dependent — §10.)

---

## 3. The lifecycle loop (activities)

```
  ┌──────────────────────────────────────────────────────────────────────┐
  ▼                                                                        │
 OBJECTIVES ─▶ GERMPLASM ─▶ CROSSING ─▶ POPULATION DEV ─▶ TRIALS ─┐        │
 (TPP per       (accessions,  (mating     (breeding         (design,│        │
  segment)       pedigree,     designs,    schemes)          layout) │        │
                 pools)        GCA/SCA)                              ▼        │
 RECYCLE ◀──── ADVANCE ◀──── SELECT ◀──── ANALYSIS ◀──── DATA CAPTURE ──────┘
 (gain,         (Advancement  (market-     (BLUP/GxE/      (as-planted
  recycle)       Decision)     specific     spatial/        layout, obs)
                               index)        genomics)
```

The **analysis → select → advance** arc is the MVP moat; it produces, then *records*, an
AdvancementDecision. Upstream (germplasm/crossing) and downstream (recycle/gain) are mapped,
built later.

---

## 4. Canonical data model (BrAPI-aligned)

BrAPI v2 names where one exists (ADR-0007); breeder-casual divergences flagged.

### Containment (the spine)
```
Program
 └─ Trial (BrAPI grouping; usually hidden in UI)
     └─ Study   (one experiment at one Location × Season)  ⟵ breeders call this a "trial"
         └─ ObservationUnit  (plot/plant; carries as-planted layout position)
             └─ Observation   (one value of one ObservationVariable)
```

### Core / experimental
| Entity | What it is |
|---|---|
| **Program** | breeding program; tenant-scoping root |
| **Trial / Study** | coordinated set / single site-season experiment |
| **Location, Season** | site; year/cycle slice |
| **ObservationUnit** | a plot (or plant); references Germplasm + SeedLot; carries layout position |
| **Observation** | one measured value |
| **Design / Layout** *(ours)* | as-designed design+randomization / **as-planted** physical map (ADR-0006) |

### Program organization — the two axes
| Entity | What it is |
|---|---|
| **Stage** *(ours)* | ordered advancement-ladder position; program-defined |
| **Segment** *(ours)* | program-defined commercial target; faceted (mechanization/climate/season/soil); effective-dated |
| **TargetProductProfile** *(ours)* | a Segment's commercial-target definition: full gate set + trait priorities (the north star) |
| **SelectionCriteria** *(ours)* | operational {gates, index} per (Segment × Stage); stage-appropriate realization of the TPP, converging to it as stage advances |
| **AdvancementDecision** *(ours)* | recorded staging move: candidate, from_stage→to_stage, **disposition** (extensible: advance/hold/drop/recycle-as-parent/…), **per Segment**, rationale, based_on AnalysisRun, date, decided_by |
| **MarketIntelligence** *(ours)* | market research feeding a Segment's TPP: which markets matter & why, consumer preferences, market size/shifts |

### Germplasm & pedigree (BrAPI-Germplasm) — *mostly mapped, not built until M5*
| Entity | What it is |
|---|---|
| **Germplasm** | accession / line / population / clone; carries Stage(s) and served Segment(s) |
| **Pedigree** | parent→progeny links; basis of **A-matrix** |
| **CrossingProject / Cross** | a crossing round / one mating; references parents; carries mating-design role (GCA/SCA) |
| **SeedLot** | seed inventory from a source; quantity, location, viability, QC |
| **IPRight / MTA** *(ours)* | PVP / plant patent / license / material-transfer-agreement status on Germplasm |
| **List** *(BrAPI List)* | a built set of germplasm (crossing block, nursery, trial entries, selection candidates); saved or dynamic; §5 |
| **Population / HeteroticGroup** *(ours)* | breeding population/family; hybrid pool tag |

**Elite collection** *(concept)* — the curated subset of Germplasm that is well-QC'd, inventory-managed,
IP-protected, and characterized (an internal genebank for elite material), leveraged frequently in
crosses and shipments. Modeled as curation/QC status on Germplasm + SeedLot inventory + IPRight, not a
separate entity.

**Inventory management** *(core daily need)* — for each **SeedLot**: quantity on hand, location, age/
viability, and whether it needs **increase**; tied to Germplasm + Pedigree. Integrating Stage/Market
metadata enables **safe-discard guidance** (obsolete material). Promote SeedLot to a first-class
inventory entity when germplasm management is built (M5).

### Traits & ontology (BrAPI-Phenotyping)
| Entity | What it is |
|---|---|
| **ObservationVariable = Trait × Method × Scale** | the measurable; used by Observations |

### Genotyping & genomic resources — *mapped, not built (M6 / discovery)*
| Entity | What it is |
|---|---|
| **Sample / CallSet / Variant / VariantSet / Call** *(BrAPI)* | material genotyped / genotypes / markers / marker states |
| **ReferenceGenome** | an assembly a breeder browses/positions against |
| **GeneticMap / PhysicalMap** | linkage / physical positions |
| **Locus / Gene / QTL** | a mapped feature of interest (with map position) |
| **MarkerPosition** | a marker's coordinate on a map/genome |
| *(genome-browser integration)* | view loci/markers/genes in context (e.g. JBrowse / BrAPI) |

### Analysis, decisions, gain (ours — moat layer)
| Entity | What it is |
|---|---|
| **AnalysisRun** | one engine execution; records intent + chosen-model rationale (ADR-0002) |
| **ResultBundle** | whole result object (JSONB); rendered + AI-queried |
| **RelationshipStructure** | identity / **A** / **G** / **H** matrix; engine input (§6) |
| **GeneticGainRecord** | realized gain across cycles; aggregates AdvancementDecisions/Studies |

### Operations & optimization (ours — mapped, not built; ADR-0011)
| Entity | What it is |
|---|---|
| **Resource / Capacity** | harvesters, quality labs, field/plot capacity, people; with throughput limits |
| **Cost** | per-operation / per-trait / per-plot costs |
| **OperationalConstraint** | scheduling, routing, capacity, timing limits |
| **Budget** | available spend by program / stage / season |
| **Plan / Schedule** | a solver output — what to do, where, when, for how much |

### Operations & compliance (ours — mapped, not built)
| Entity | What it is |
|---|---|
| **Shipment** | germplasm/sample movement: contents (SeedLots), origin→destination, tracking, cost; an optimization target (ADR-0011 logistics) |
| **Payment** | cost/invoice tied to shipments, lab work, operations |
| **PhytosanitaryRecord / Permit** | phyto certificates, import/export permits, regulatory documents |
| **DiseaseTest** | pathogen testing results required for movement/clearance |

---

## 5. List-building & diversity management

A high-frequency core activity, not a side feature. Breeders cannot make every cross, so they
assemble **bounded, intelligent sets** of parents/candidates.

- **List** is first-class (BrAPI List), built by querying **Stage + Segment + provenance +
  performance** (e.g. "all commercial parents + pre-commercial stage 2/1 + top-decile GWS
  inbreds, capped at N"). Saved or dynamic. A prime **AI-assisted** surface.
- **Diversity vs. gain:** a pool/list must be an *elite subset* yet retain enough useful
  diversity to sustain ΔG over cycles → **coancestry / effective-population-size–aware**
  composition (optimal-contribution territory; `optiSel`, A-matrix). The platform should
  compute pool diversity and steer it ("gain-rich but coancestry climbing; here's a more
  diverse set at ~95% of the gain").

This is how the σ_A term of §1 is actively managed.

---

## 6. The engine contract, generalized

```
analyze(
  data,                 # observations, scoped by Segment/Stage intent (discovery isolated)
  intent,               # selection | comparison | prediction
  design + layout,      # incl. as-planted spatial coordinates
  relationship = identity | A(pedigree) | G(markers) | H(single-step),
  objective             # the target Segment's TPP (directions/weights)
) -> ResultBundle( effects, varcomp, heritability, genetic_correlations,
                   chosen_model_rationale, diagnostics, index(es), warnings )
```

- **Data scoping is part of the contract:** what material feeds a model is a deliberate,
  expert-guided choice (§2.2 discovery isolation), not an accident of what's in the table.
- **MVP fills:** `relationship = identity`, single-trial/MET, spatial, market-specific index.
- **Mapped, not built:** `A | G | H` (M5–6) drop into the same signature — pedigree, genomic,
  and single-step BLUP are one model with different relationship matrices (Mrode; Bernardo).

---

## 7. Reproductive biology parameterizes everything

The model is parametric over mating system, not hard-coded to one crop (Acquaah):

| System | Examples | Consequences |
|---|---|---|
| Self-pollinated | tomato (beachhead), wheat | inbred lines; pedigree/bulk/SSD/backcross; line-mean h² |
| Cross-pollinated | maize (G2F dev set) | populations, recurrent selection, heterotic groups, GCA/SCA |
| Clonal | potato, cassava | clonal selection; total genetic value (incl. dominance) |
| Hybrid | maize, vegetables | inbred dev + testcross + combining ability + hybrid prediction |

Building to span self (tomato) and cross/hybrid (maize) forces genuine generality (ADR-0008).

---

## 8. Where each milestone attaches (built vs mapped)

| Milestone | Built | Mapped, not built |
|---|---|---|
| **0 — tracer bullet** | Study, ObservationUnit, Observation, AnalysisRun, ResultBundle | rest |
| **1 — analysis moat** | + Design, Layout, ObservationVariable, market-specific index, **Segment + TPP (light)**, RelationshipStructure(identity) | pedigree, crossing, genomics |
| **2 — SaaS-ize** | + Program/Trial scoping, Users, persistence, **Stage + AdvancementDecision** | — |
| **4 — designer** | + Design generation, SeedLot (light) | — |
| **5 — germplasm/gain** | + Germplasm, Pedigree, **List + diversity-aware pools**, Population, A-matrix, CrossingProject/Cross, GeneticGainRecord, **elite-collection curation**, **inventory management** (SeedLot depth, increase, safe-discard), market intelligence | — |
| **post-MVP — operations & compliance** | + Shipment, Payment, Phytosanitary/Permit, DiseaseTest (shipping coordination) | — |
| **6 — genomics** | + Sample/CallSet/Variant/Call, G & H matrices, **genomic resources** (genomes/maps/loci/marker positions + browser) | — |
| **7 — capture** | + Field Book/BrAPI import, mobile capture | — |
| **post-MVP — decision-support** | + optimization (allocation) & simulation via Python solver service; Resource/Cost/Budget/Constraint/Plan (ADR-0011) | logistics & crossing/pollination optimization (at scale) |

**Stage + AdvancementDecision + Segment are pulled forward** (M1–2): the analysis→select→advance
arc is the moat, and recording the decision is what closes it. List/pool diversity work needs the
germplasm collection (M5) but its data model is shaped now.

---

## 9. Cross-cutting modeling principles

- **Two program-defined axes** — Stage (ordinal) and Market/Segment (faceted, effective-dated).
- **Market-specific index** — the objective comes from the target Segment's TPP; same data,
  different segment, different ranking.
- **Decisions are data** — AdvancementDecision and AnalysisRun rationale are queryable → genetic
  gain is measurable, the AI narrates from records, the program keeps institutional memory.
- **Data scoping is deliberate** — discovery/exotic material isolated from pipeline predictions.
- **Relationship structure is a first-class engine input** — A/G/H are configurations, not forks.
- **BrAPI naming where it exists; parametric over reproductive biology; tenant-scoped to Program.**
- **Advanced methods stay AI-forward and simple** — optimization/simulation are driven by
  plain-language goals/constraints the AI formulates and explains, never an OR interface dumped on
  the user (effective, trustworthy, transparent, fun, easy — ADR-0011).

---

## 10. Open questions (still to resolve)

1. **Sub-segment resolution** — is a Segment-level TPP enough, or do you need a target environment
   *within* a segment as a distinct objective?
2. **The real disposition set** for AdvancementDecision beyond advance/hold/drop/recycle-as-parent.
3. **Reproductive-biology emphasis for the tomato beachhead** — how much hybrid/combining-ability
   machinery vs. inbred-line workflow for v1? (Drives whether early-stage selection is on combining
   ability vs per-se — §2.4.)
4. **Germplasm/seed-inventory/nursery logistics depth** needed to be useful vs. academic.
5. *(swept)* The lifecycle has been broadly mapped through grilling; the full capability list lives in
   [PRD.md](PRD.md). Remaining unknowns are later-milestone depth, not MVP blockers.

**Resolved:** Stage is per (candidate × Segment) — §2.3. Selection = gates + index, both per
(Segment × Stage); TPP is the Segment-level target, SelectionCriteria the per-(Segment × Stage)
operational rule converging to it — §2.4.
