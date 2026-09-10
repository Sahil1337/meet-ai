#!/usr/bin/env node
// CLI for the JSON-backed retrieval pipeline.
//
//   node rag.ts add "Ollama listens on port 11434."
//   node rag.ts add-file notes.txt          (one proposition per line)
//   node rag.ts query "which port?"
//   node rag.ts list | stats | remove <id> | clear
import { readFileSync } from 'node:fs';
import { JsonVectorStore, type Metadata } from './lib/store.ts';
import { bar } from './lib/gemini.ts';

const [command, ...rest] = process.argv.slice(2);

/** Pull `--flag value` pairs out, leaving the positional args behind. */
function takeFlags(args: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) flags.set(a.slice(2), args[++i] ?? 'true');
    else positional.push(a);
  }
  return { positional, flags };
}

function parseMeta(raw: string | undefined): Metadata {
  if (!raw) return {};
  // --meta source=readme,topic=gpu
  const meta: Metadata = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) meta[k.trim()] = v.trim();
  }
  return meta;
}

const { positional, flags } = takeFlags(rest);
const store = JsonVectorStore.open(flags.get('store'));

function usage(): never {
  console.log(`usage: node rag.ts <command>

  add "<proposition>" [--meta k=v,k2=v2]   embed one proposition and store it
  add-file <path> [--meta k=v]             one proposition per non-empty line
  query "<question>" [--top 5] [--min 0.5] [--filter k=v]
  list [--full]                            show stored propositions
  dupes [--min 0.9]                        find near-duplicate claims (no API calls)
  stats                                    store size, model, dimensions
  remove <id>                              delete one record
  clear                                    delete everything

  --store <path>   use a different JSON file (default: data/store.json)`);
  process.exit(1);
}

switch (command) {
  case 'add': {
    const text = positional.join(' ');
    if (!text) usage();
    const rec = await store.add(text, parseMeta(flags.get('meta')));
    console.log(`stored ${rec.id}  (${rec.vector.length}d)  ${rec.text}`);
    console.log(`store now holds ${store.size} record(s) -> ${store.path}`);
    break;
  }

  case 'add-file': {
    const path = positional[0];
    if (!path) usage();
    const lines = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    const added = await store.addMany(lines, parseMeta(flags.get('meta')));
    console.log(`embedded ${added.length} line(s) from ${path} in one batch call`);
    for (const r of added) console.log(`  ${r.id}  ${r.text.slice(0, 70)}`);
    console.log(`store now holds ${store.size} record(s)`);
    break;
  }

  case 'query': {
    const q = positional.join(' ');
    if (!q) usage();
    const topK = Number(flags.get('top') ?? 5);
    const minScore = flags.has('min') ? Number(flags.get('min')) : undefined;
    const filter = flags.has('filter') ? parseMeta(flags.get('filter')) : undefined;

    const started = Date.now();
    const hits = await store.search(q, {
      topK,
      ...(minScore !== undefined ? { minScore } : {}),
      ...(filter ? { filter } : {}),
    });
    const ms = Date.now() - started;

    console.log(`? ${q}`);
    console.log(`  (searched ${store.size} record(s) in ${ms} ms)\n`);
    if (hits.length === 0) {
      console.log('  no hits' + (minScore !== undefined ? ` above --min ${minScore}` : ''));
      break;
    }
    hits.forEach((h, i) => {
      const meta = Object.keys(h.metadata).length ? `  ${JSON.stringify(h.metadata)}` : '';
      console.log(`  ${i + 1}. ${h.score.toFixed(4)} ${bar(h.score, 20)}  ${h.text}${meta}`);
    });
    break;
  }

  case 'list': {
    const full = flags.has('full');
    if (store.size === 0) console.log('store is empty');
    for (const r of store.all()) {
      console.log(`${r.id}  ${full ? r.text : r.text.slice(0, 80)}`);
    }
    break;
  }

  case 'stats': {
    const info = store.info;
    console.log(`path       : ${store.path}`);
    console.log(`records    : ${store.size}`);
    console.log(`model      : ${info.model}`);
    console.log(`dimensions : ${info.dimensions}`);
    console.log(`doc task   : ${info.taskType}`);
    console.log(`created    : ${info.createdAt}`);
    const kb = store.bytesOnDisk / 1024;
    const per = store.size ? ` (${(kb / store.size).toFixed(1)} KB/record)` : '';
    console.log(`file size  : ${kb.toFixed(0)} KB${per}`);
    break;
  }

  case 'dupes': {
    const threshold = Number(flags.get('min') ?? 0.9);
    const pairs = store.findDuplicates(threshold);
    console.log(`${pairs.length} pair(s) above ${threshold} out of ${store.size} records\n`);
    for (const p of pairs) {
      console.log(`${p.score.toFixed(4)}`);
      console.log(`  A ${p.a.id} [chunk ${p.a.metadata.chunk ?? '?'}] ${p.a.text}`);
      console.log(`  B ${p.b.id} [chunk ${p.b.metadata.chunk ?? '?'}] ${p.b.text}\n`);
    }
    break;
  }

  case 'remove': {
    const id = positional[0];
    if (!id) usage();
    console.log(store.remove(id) ? `removed ${id}` : `no record with id ${id}`);
    break;
  }

  case 'clear': {
    const n = store.size;
    store.clear();
    console.log(`cleared ${n} record(s)`);
    break;
  }

  default:
    usage();
}
