export type Effect = { genotype: string; value: number; type: string };

export type IndexRow = {
  rank: number;
  genotype: string;
  index: number;
} & Record<string, number | string>;

export type Bundle = {
  traits: string[];
  effects: Record<string, Effect[]>;
  heritability: Record<string, number>;
  engine: string;
  warnings: string[] | string;
  index: IndexRow[];
};

export type AssistantResponse = {
  reply: string;
  configured: boolean;
  tool_calls: { tool: string; args: unknown }[];
};

export type TrialRow = Record<string, string | number>;
