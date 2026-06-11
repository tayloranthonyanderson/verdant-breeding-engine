-- 0001_init.sql — core data backbone for the breeding platform.
-- Designed for the full management platform and for scale: long-format
-- observations, tenant scoping on every owned row, result bundles stored whole.

CREATE TABLE IF NOT EXISTS program (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id  BIGINT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'member',
    seat_active BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trial (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id  BIGINT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    crop        TEXT NOT NULL DEFAULT 'tomato',
    design_type TEXT,
    season      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environment (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trial_id    BIGINT NOT NULL REFERENCES trial(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    site        TEXT,
    year        INT,
    UNIQUE (trial_id, label)
);

CREATE TABLE IF NOT EXISTS genotype (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id  BIGINT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    pedigree    TEXT,
    UNIQUE (program_id, name)
);

CREATE TABLE IF NOT EXISTS trait (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id    BIGINT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    unit          TEXT,
    direction     INT NOT NULL DEFAULT 1,      -- +1 higher-better, -1 lower-better
    default_weight DOUBLE PRECISION NOT NULL DEFAULT 1,
    UNIQUE (program_id, name)
);

-- Long-format observations: one row per plot per trait. Scale- and
-- breeder-friendly; this is how the engine consumes data.
CREATE TABLE IF NOT EXISTS observation (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trial_id       BIGINT NOT NULL REFERENCES trial(id) ON DELETE CASCADE,
    environment_id BIGINT REFERENCES environment(id) ON DELETE SET NULL,
    env_label      TEXT,            -- denormalized for fast load + engine reads
    genotype_label TEXT NOT NULL,   -- denormalized for fast bulk load; FK-able later
    block          TEXT,
    rep            INT,
    row_pos        INT,
    col_pos        INT,
    trait_name     TEXT NOT NULL,
    value          DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS observation_trial_idx ON observation (trial_id);
CREATE INDEX IF NOT EXISTS observation_trial_trait_idx ON observation (trial_id, trait_name);

CREATE TABLE IF NOT EXISTS analysis_run (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trial_id        BIGINT NOT NULL REFERENCES trial(id) ON DELETE CASCADE,
    engine          TEXT NOT NULL,
    genotype_effect TEXT NOT NULL,
    model_spec      JSONB,
    status          TEXT NOT NULL DEFAULT 'complete',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The whole result bundle, stored as JSON keyed by the run. We render and the
-- AI assistant queries the object; we rarely SQL-query individual BLUPs.
CREATE TABLE IF NOT EXISTS result (
    analysis_run_id BIGINT PRIMARY KEY REFERENCES analysis_run(id) ON DELETE CASCADE,
    payload         JSONB NOT NULL
);
