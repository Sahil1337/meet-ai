/**
 * The composition root: the ONE place the five units meet. Every package
 * depends only on @meetai/core; this file is where concrete implementations
 * are chosen and handed to each other. If you find yourself importing
 * @meetai/memory from inside @meetai/ingestion, the import belongs here
 * instead.
 *
 * Wiring is real; most of the things being wired are stubs until their
 * owners fill them in. Opening the index is async (the embedded database
 * boots), which is why this is the one async step at startup.
 */

import { createAnswerer, createExtractor } from "@meetai/ai";
import type {
  Answerer,
  Extractor,
  Indexer,
  JobStore,
  MeetingStore,
  MemoryQueries,
  ProjectMemory,
  ProjectStore,
  PropositionStore,
  Searcher,
} from "@meetai/core";
import { loadConfig, type Config } from "@meetai/ingestion";
import {
  InMemoryJobStore,
  InMemoryMeetingStore,
  InMemoryMemoryQueries,
  InMemoryProjectMemory,
  InMemoryProjectStore,
  InMemoryPropositionStore,
} from "@meetai/memory";
import { HttpEmbedder, HybridSearcher, openIndex, PropositionIndexer } from "@meetai/retrieval";
import { QwenProxyClient } from "@meetai/proxy/client";

export type Container = {
  config: Config;
  projects: ProjectStore;
  meetings: MeetingStore;
  jobs: JobStore;
  propositions: PropositionStore;
  memory: ProjectMemory;
  queries: MemoryQueries;
  extractor: Extractor;
  answerer: Answerer;
  indexer: Indexer;
  searcher: Searcher;
};

export async function createContainer(): Promise<Container> {
  const config = loadConfig();
  const proxy = new QwenProxyClient({ baseUrl: config.proxyBaseUrl, apiKey: config.proxyApiKey });
  // Model name and dimensions are retrieval's decision; placeholders until unit 4 picks one.
  const embedder = new HttpEmbedder(config.embedderBaseUrl, "unchosen", 768);
  // The index is Postgres + pgvector at `DATABASE_URL`, in development too.
  // Opened here and nowhere else — everyone upstream only ever sees `Indexer`
  // and `Searcher`.
  const index = await openIndex({
    url: config.databaseUrl,
    model: embedder.model,
    dimensions: embedder.dimensions,
  });
  return {
    config,
    projects: new InMemoryProjectStore(),
    meetings: new InMemoryMeetingStore(),
    jobs: new InMemoryJobStore(),
    propositions: new InMemoryPropositionStore(),
    memory: new InMemoryProjectMemory(),
    queries: new InMemoryMemoryQueries(),
    extractor: createExtractor(proxy),
    answerer: createAnswerer(proxy),
    indexer: new PropositionIndexer(embedder, index),
    searcher: new HybridSearcher(embedder, index),
  };
}
