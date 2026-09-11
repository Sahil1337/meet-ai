# MeetIQ — RAG Reading List

Two questions only: **how to embed chunks well** and **how to retrieve well**. Read in order within each section.

## A. Embedding chunks well — what to embed, how big, with what context, which model

| # | Resource | Link | Why we read it |
|---|----------|------|----------------|
| A1 | **Dense X Retrieval: What Retrieval Granularity Should We Use?** — Chen et al., 2023 | https://arxiv.org/abs/2312.06648 | **What unit should we embed?** Compares passages vs sentences vs atomic "propositions" and shows propositions retrieve best. A proposition is our claim. This decides the claims layer. Read fully. |
| A2 | **Introducing Contextual Retrieval** — Anthropic, 2024 (blog) | https://www.anthropic.com/news/contextual-retrieval | **How do we stop a chunk losing its context?** Prepend a short generated header (meeting, date, topic) to every chunk before embedding. Measured 35–67% fewer retrieval failures. 10-minute read, directly actionable. |
| A3 | **Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models** — Günther et al., 2024 | https://arxiv.org/abs/2409.04701 | **Alternative to A2.** Embed the whole segment first, then split the token embeddings into chunks, so each chunk vector already "knows" its neighbours. No LLM call needed. Compare with A2 and pick one. Read Sections 1–3. |
| A4 | **Is Semantic Chunking Worth the Computational Cost?** — Qu et al., 2024 · plus Chroma's chunking evaluation | https://arxiv.org/abs/2410.13070 · https://www.trychroma.com/research/evaluating-chunking | **How big should chunks be, and does clever splitting help?** Both measure fixed-size vs semantic vs recursive chunking. Finding: simple boundaries + modest size + overlap usually win. Saves us from over-engineering the chunker. Read the results sections. |
| A5 | **MTEB leaderboard** | https://huggingface.co/spaces/mteb/leaderboard | **Which embedding model?** Sort by the *Retrieval* column, not the overall score. Pick one model, store its name on every row, never mix. |

## B. Retrieving well — search, fusion, rerank, how much to send

| # | Resource | Link | Why we read it |
|---|----------|------|----------------|
| B1 | **Retrieval-Augmented Generation for Large Language Models: A Survey** — Gao et al., 2023 | https://arxiv.org/abs/2312.10997 | **How does the whole retrieval pipeline fit together?** Every stage named and explained. Read fully first. |
| B2 | **Searching for Best Practices in Retrieval-Augmented Generation** — Wang et al., 2024 | https://arxiv.org/abs/2407.01219 | **Which optimisations actually help?** Tests each module (chunk size, embedding, hybrid search, rerank, compression) one at a time and reports the best setting for each. Closest thing to a recipe. Read fully. |
| B3 | **Reciprocal Rank Fusion** — Cormack, Clarke & Buettcher, SIGIR 2009 | http://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf | **How do we merge vector results with keyword (BM25) results?** Two pages, one formula. This is our hybrid search fusion step. Read all of it. |
| B4 | **Passage Re-ranking with BERT** — Nogueira & Cho, 2019 | https://arxiv.org/abs/1901.04085 | **How do we fix "right chunk is in top 20 but not top 3"?** Cross-encoder rerank: score question + chunk together on the top 50, keep 5–8. Read when recall is fine but precision is not. |
| B5 | **RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval** — Sarthi et al., 2024 | https://arxiv.org/abs/2401.18059 | **How do we search across levels (meeting → segment → chunk)?** Summary tree over chunks, retrieve from all levels at once. This is our layered / high-level-to-depth retrieval. Read Sections 3–4. |
| B6 | **Lost in the Middle: How Language Models Use Long Contexts** — Liu et al., 2023 | https://arxiv.org/abs/2307.03172 | **How many chunks do we send to the model?** More context makes answers worse; the middle gets ignored. Keep top-k small, best evidence first. Read Sections 1–3. |

## Later, only when needed

- **Zep** — https://arxiv.org/abs/2501.13956 — when we add `valid_from` / `superseded_by` to claims (time-aware memory).
- **AMI Meeting Corpus** — https://groups.inf.ed.ac.uk/ami/corpus/ — labelled meeting transcripts with DECISIONS / ACTIONS sections, for test data.
- **RAGAS** — https://arxiv.org/abs/2309.15217 — when we start measuring answer quality.
