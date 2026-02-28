# LLM GM — AI Dungeon Master System

An LLM-based TTRPG (tabletop role-playing game) AI Dungeon Master system. Users create fantasy worlds (NPCs, items, abilities, story graphs), then play as adventurers against an AI DM. The core is a **20-node multi-agent pipeline** that handles intent classification, vector retrieval, dice mechanics, combat resolution, streaming narrative generation, and state persistence in a single closed loop.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 15 (App Router) + React 19 |
| **Database** | Supabase (PostgreSQL + pgvector) |
| **LLM** | OpenAI GPT-4.1 (Function Calling + Streaming) |
| **Vector Search** | text-embedding-3-small (1536-dim), pgvector IVFFlat |
| **Real-time** | SSE (Server-Sent Events) |
| **UI** | Tailwind CSS + shadcn/ui (Radix) |
| **Animations** | Framer Motion |
| **Story Editor** | ReactFlow / XYFlow |
| **Forms** | React Hook Form + Zod |
| **Observability** | LangSmith (optional, `wrapOpenAI()`) |

**No LangChain.** The entire pipeline is built directly on the OpenAI SDK (`openai` npm package), with each node as an independent TypeScript function orchestrated by `workflow.ts`.

## Features

### World Building
- Create worlds with custom settings, tone, and starter text
- Define NPCs (with combat stats, equipment, abilities, dc thresholds)
- Define items (weapons, armor, accessories, consumables with JSONB stats)
- Define abilities (damage, MP cost, HP restore, acquisition DC)
- Define locations (with aliases, connected via story nodes)
- Story graph editor (nodes + edges, completion triggers, ending scripts)
- Custom player fields (gold, reputation, etc.)
- Auto-generated vector embeddings for all entities

### Gameplay (AI DM Pipeline)
- **7 intent types**: COMBAT, SPELL_CAST, ITEM_USE, EXPLORE, SOCIAL, NARRATIVE, META
- **Intent-aware RAG**: retrieval strategy adapts per intent (thresholds, table weights)
- **d12 dice system**: 5 dimensions (Combat, Persuasion, Chaos, Charm, Wit), adaptive DC scaling
- **ATK-DEF combat**: `max(1, ATK - DEF)` for physical, `max(1, ability_damage - DEF)` for spells
- **9-slot equipment**: 2 weapons + 3 armor + 4 accessories, auto-equip on pickup
- **NPC combat AI**: LLM strategy agent with pure-function fallback
- **NPC memory**: cross-turn attitude and memory tracking
- **Milestone detection**: 5-dimension scoring for significant events
- **Story progression**: automatic node completion and edge traversal
- **Streaming narrative**: SSE real-time text + structured events (dice, combat, progress)
- **Location system**: 3-pass regex + LLM authoritative confirmation
- **Multi-layer anti-hallucination**: combat safety net, target gating, HP double-deduction guard, catalog validation, vague target rejection

### Frontend
- Streaming chat with DM narrative
- Player panel (HP/MP/ATK/DEF, inventory, abilities, attributes)
- Enemy panel (HP bar, abilities, equipment, per-turn action display)
- Dice animation and combat summary
- SSE-driven progress bar

## Project Structure

```
llm-gm/
├── app/
│   ├── api/
│   │   ├── dm-response/           # Core DM pipeline
│   │   │   ├── workflow.ts        # 20-node orchestrator (~1700 lines)
│   │   │   ├── route.ts           # SSE endpoint (POST /api/dm-response)
│   │   │   ├── prompts.ts         # DM system prompts
│   │   │   ├── nodes/             # 31 pipeline node files
│   │   │   │   ├── 0-action-validity-gate.ts
│   │   │   │   ├── 1-input-validation.ts
│   │   │   │   ├── 2-intent-classifier.ts
│   │   │   │   ├── 2-data-retrieval.ts
│   │   │   │   ├── 2c-meta-handler.ts
│   │   │   │   ├── 3a-intent-aware-rag.ts
│   │   │   │   ├── 3b-player-state-loader.ts
│   │   │   │   ├── 3c-scenario-event-generator.ts
│   │   │   │   ├── 3e-story-state-loader.ts
│   │   │   │   ├── 3f-npc-memory-loader.ts
│   │   │   │   ├── 3-context-assembly.ts
│   │   │   │   ├── 4-precondition-validator.ts
│   │   │   │   ├── 4-prompt-construction.ts
│   │   │   │   ├── 5-dice-engine.ts
│   │   │   │   ├── 5-llm-generation.ts
│   │   │   │   ├── 6-outcome-synthesizer.ts
│   │   │   │   ├── 6-output-persistence.ts
│   │   │   │   ├── 6b-npc-action-agent.ts
│   │   │   │   ├── 6c-npc-combat-strategy-agent.ts
│   │   │   │   ├── 7-dynamic-field-update.ts
│   │   │   │   ├── 11-hp-mp-updater.ts
│   │   │   │   ├── 12-inventory-updater.ts
│   │   │   │   ├── 13-status-effect-updater.ts
│   │   │   │   ├── 14-events-log-writer.ts
│   │   │   │   ├── 15-attribute-updater.ts
│   │   │   │   ├── 16-milestone-detector.ts
│   │   │   │   ├── 17-story-node-completion.ts
│   │   │   │   ├── 18-npc-memory-updater.ts
│   │   │   │   ├── 19-narrative-state-sync.ts
│   │   │   │   ├── 19b-equipment-manager.ts
│   │   │   │   └── rag-retrieval.ts
│   │   │   └── types/             # Pipeline type definitions
│   │   ├── generate-embedding/    # POST /api/generate-embedding
│   │   └── admin/                 # POST /api/admin/reembed
│   ├── auth/                      # Auth pages (login/signup)
│   ├── browse/                    # Browse worlds
│   ├── manage/                    # World editor (tabbed UI)
│   ├── sessions/                  # Game session pages
│   │   └── [id]/page.tsx          # Main gameplay UI (~2500 lines)
│   ├── layout.tsx
│   └── page.tsx                   # Landing page
├── components/
│   ├── layout/                    # Navbar, etc.
│   ├── ui/                        # shadcn/ui components
│   └── world-editor/              # World editor components
├── contexts/                      # React contexts (Auth)
├── lib/
│   ├── config.ts                  # Model configuration (MODEL_FAST, etc.)
│   ├── supabase/                  # Supabase client setup
│   ├── database.types.ts          # Generated DB types
│   └── utils.ts
├── migrations/                    # Supabase SQL migrations
├── scripts/                       # Batch embedding scripts
└── docs/                          # Architecture documentation
```

## Database Schema

### World Tables (Canon)

| Table | Purpose |
|-------|---------|
| `worlds` | World settings, tone, description, starter text |
| `npcs` | NPCs with combat_stats (JSONB), dc_thresholds, embedding |
| `items` | Items with item_stats (JSONB: weapon/armor/accessory/consumable), embedding |
| `abilities` | Abilities with ability_stats (JSONB: damage, mp_cost, hp_restore), embedding |
| `npc_abilities` | NPC-ability junction (which NPCs know which abilities) |
| `npc_equipment` | NPC equipment (slot_type, droppable flag) |
| `locations` | Locations with aliases, embedding |
| `organizations` | Factions and groups |
| `taxonomies` | Classification systems |
| `rules` | World rules and mechanics |
| `story_nodes` | Story graph nodes (node_type, completion_trigger, ending_script) |
| `story_edges` | Story graph edges (from/to, edge_type) |
| `world_player_fields` | Custom player field definitions per world |

### Session Tables (Runtime)

| Table | Purpose |
|-------|---------|
| `sessions` | Game sessions (world_id, current_location_id) |
| `players` | Player characters (dynamic_fields JSONB) |
| `player_core_stats` | HP, MP, ATK, DEF |
| `player_inventory` | Items + abilities (item_name, quantity, equipped, slot_type, item_id FK) |
| `player_custom_attributes` | 5 dimensions: combat, persuasion, chaos, charm, wit |
| `player_status_effects` | Buffs/debuffs (duration, effect_type) |
| `session_messages` | Chat history |
| `session_npc_stats` | Per-session NPC HP/MP (current_hp, is_alive, in_combat) |
| `session_npc_memories` | NPC attitude, status, key memories |
| `session_milestones` | Significant events (5-dim scoring, threshold 40) |
| `session_story_state` | Story node status (active/completed) |
| `session_events` | Full turn log (intent, dice, outcome, effects, latency) |

## Pipeline Overview

Each player message triggers a 20-node pipeline through `POST /api/dm-response`:

```
Input Validation → Parallel(Data + Intent) → META short-circuit
  → Player State → Parallel(RAG + Scenario + Milestones + Story + NPC Memory)
  → Location System → Action Gate → Vague Target Check
  → Combat Safety Net → Retry Penalty → DC Override
  → Preconditions → Dice Engine → Equipment/NPC Preprocessing
  → Combat Detection → NPC Strategy → Outcome Synthesis → NPC Actions
  → Death Detection → Context Assembly → Prompt → Streaming LLM → SSE
  → Phase 1: Parallel(HP/Inventory/Status/Events/Attrs/Milestone/Story/NPC Memory)
  → Phase 2: Dynamic Fields → Phase 3: Narrative Sync → Phase 4: Equipment Manager
```

10-12 LLM calls per turn, parallelized with `Promise.all`. See [docs/PIPELINE_DOCUMENTATION.md](docs/PIPELINE_DOCUMENTATION.md) for full technical documentation.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/dm-response` | POST | Core pipeline (SSE streaming response) |
| `/api/generate-embedding` | POST | Generate vector embedding for an entity |
| `/api/admin/reembed` | POST | Batch re-embed all entities in a world |

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project
- An OpenAI API key

### Installation

```bash
git clone <your-repo-url>
cd llm-gm
npm install
```

### Environment Variables

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-...
# Optional: LangSmith tracing
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your-langsmith-key
```

### Database Setup

Run migrations in order from the `migrations/` folder in your Supabase SQL Editor:

```bash
# Or with Supabase CLI:
for file in migrations/*.sql; do
  supabase db execute -f "$file"
done
```

### Run

```bash
npm run dev
# Open http://localhost:3000
```

## Documentation

- [Pipeline Technical Documentation](docs/PIPELINE_DOCUMENTATION.md) — Full 20-node pipeline architecture
- [Interview Guide](docs/INTERVIEW.md) — Project walkthrough for interviews
- [Resume Prompt](docs/RESUME_PROMPT.md) — Resume material for LLM-assisted writing
