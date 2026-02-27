# DM Response Generation Workflow

This API endpoint generates DM responses for player actions in a TTRPG session using an LLM workflow architecture.

## File Structure

```
app/api/dm-response/
├── route.ts           # Thin API wrapper (~60 lines)
├── workflow.ts        # Main orchestrator
├── prompts.ts         # Prompt templates (configuration)
├── nodes/             # Self-contained workflow steps
│   ├── 1-input-validation.ts
│   ├── 2-data-retrieval.ts
│   ├── 3-context-assembly.ts    # Includes builder functions
│   ├── 4-prompt-construction.ts
│   ├── 5-llm-generation.ts
│   ├── 6-output-persistence.ts
│   └── 7-dynamic-field-update.ts # LLM-powered field updates
└── README.md
```

## Workflow Architecture

The workflow follows a clear pipeline pattern similar to LangChain/Dify workflows:

```
Input → Retrieval → Assembly → Construction → Generation → Persistence → Field Update → Output
```

Each step is a discrete **node** with well-defined inputs and outputs.

## Workflow Nodes

### Node 1: Input Validation
**File:** `nodes/1-input-validation.ts`
- **Purpose:** Validates incoming request data
- **Input:** `{ sessionId?, playerMessage? }`
- **Output:** `{ sessionId, playerMessage }`
- **Errors:** Throws if required fields are missing

### Node 2: Data Retrieval (RAG-Powered)
**File:** `nodes/2-data-retrieval.ts`
- **Purpose:** Fetches relevant data from the database using RAG (Retrieval-Augmented Generation)
- **Input:** `{ sessionId, playerMessage, supabase, openai }`
- **Output:** `{ world, items, locations, abilities, organizations, taxonomies, rules, npcs, playerFields, player, messageHistory }`
- **Operations:**
  - Fetches session and world data
  - **[RAG]** Builds enhanced query from player message + conversation history
  - **[RAG]** Generates query embedding (1536-dimensional vector)
  - **[RAG]** Performs vector similarity search for each entity type
  - **[RAG]** Returns only top K most relevant entities (vs. all entities)
  - Fetches player data and recent message history
- **Performance:**
  - Old approach: Retrieves ALL entities (~8000 tokens)
  - New approach: Retrieves top 3-5 per category (~2000 tokens, 75% reduction)

### Node 3: Context Assembly
**File:** `nodes/3-context-assembly.ts`
- **Purpose:** Builds context sections from retrieved data
- **Input:** All retrieved data from Node 2
- **Output:** Individual context strings for each aspect (world, items, locations, etc.)
- **Contains:** Builder functions for each context type (self-contained)

### Node 4: Prompt Construction
**File:** `nodes/4-prompt-construction.ts`
- **Purpose:** Constructs the final LLM prompt from context sections
- **Input:** `{ contextSections, playerMessage }`
- **Output:** `{ userPrompt }`
- **Uses:** Prompt templates from `prompts.ts`

### Node 5: LLM Generation
**File:** `nodes/5-llm-generation.ts`
- **Purpose:** Calls the LLM to generate the DM response
- **Input:** `{ userPrompt, openai }`
- **Output:** `{ dmResponse }`
- **LLM Config:**
  - Model: GPT-4
  - Max tokens: 1000
  - Temperature: 0.8

### Node 6: Output Persistence
**File:** `nodes/6-output-persistence.ts`
- **Purpose:** Saves the DM response to the database
- **Input:** `{ sessionId, dmResponse, supabase }`
- **Output:** `{ dmResponse, messageId }`
- **Note:** Returns response even if save fails

### Node 7: Dynamic Field Update
**File:** `nodes/7-dynamic-field-update.ts`
- **Purpose:** Analyzes the DM response and updates player fields based on what happened
- **Input:** `{ sessionId, dmResponse, playerMessage, openai, supabase }`
- **Output:** `{ fieldsUpdated, updates }`
- **Features:**
  - Uses OpenAI function calling to determine field changes
  - Fetches current player state and field definitions
  - Analyzes player action + DM response for mechanical changes
  - Automatically updates player fields in database
  - Conservative approach - only updates when confident
- **Tool Used:** `update_player_fields` function with field name, new value, and reason
- **Examples of updates:**
  - Player takes damage → Update Health field
  - Player uses spell → Update Mana field
  - Player gains gold → Update Gold field
  - Player gets status effect → Update Status field

## Supporting Files

### `workflow.ts`
The main orchestrator that chains all nodes together. Each node is called sequentially with the output of the previous node.

### `prompts.ts`
Contains all prompt templates and constants (configuration, not logic):
- `SYSTEM_PROMPT`: System message for the DM LLM
- `DM_GUIDELINES`: Detailed instructions for DM behavior
- `FIELD_UPDATE_SYSTEM_PROMPT`: System message for field update analysis
- Header constants for each context section (e.g., `WORLD_SETTING_HEADER`, `ITEMS_HEADER`)

### `route.ts`
The Next.js API route handler. Acts as a thin wrapper around the workflow (~60 lines):
1. Parses request
2. Initializes Supabase client
3. Calls `executeDMResponseWorkflow()`
4. Returns response with proper error handling

### `nodes/rag-retrieval.ts` (RAG Utilities)
RAG-specific utility functions and configuration:
- `RAG_CONFIG`: Configuration for Top K and similarity threshold
- `generateEmbedding()`: Generate query embedding using OpenAI
- `buildRAGQuery()`: Enhance query with conversation history
- `retrieveRelevant*()`: 7 functions for entity-specific retrieval

## Workflow Execution

```typescript
// In route.ts
const result = await executeDMResponseWorkflow({
  sessionId,
  playerMessage,
  supabase,
  openai,
})
```

The workflow executes as follows:

```typescript
// In workflow.ts
validatedInput = validateInput({ sessionId, playerMessage })
  ↓
retrievedData = retrieveData({
  sessionId,
  playerMessage,  // ← NEW: for RAG query
  supabase,
  openai  // ← NEW: for embedding generation
})
  ↓ [RAG happens here - vector similarity search]
contextSections = assembleContext(retrievedData)  // ← Only relevant entities
  ↓
{ userPrompt } = constructPrompt({ contextSections, playerMessage })
  ↓
{ dmResponse } = generateResponse({ userPrompt, openai })
  ↓
output = persistOutput({ sessionId, dmResponse, supabase })
  ↓
analyzeDynamicFieldUpdates({ sessionId, dmResponse, playerMessage, openai, supabase })
  ↓
return output
```

### RAG Query Flow (Inside Node 2)

```typescript
// 1. Build enhanced query
ragQuery = buildRAGQuery(playerMessage, messageHistory)
// "Player: I attack the goblin\nDM: The goblin is wounded..."

// 2. Generate query embedding
queryEmbedding = await generateEmbedding(ragQuery, openai)
// [0.123, -0.456, 0.789, ...] (1536 dimensions)

// 3. Parallel vector search
[items, abilities, locations, npcs, ...] = await Promise.all([
  retrieveRelevantItems(supabase, worldId, queryEmbedding),    // Top 5 items
  retrieveRelevantAbilities(supabase, worldId, queryEmbedding), // Top 5 abilities
  // ... 7 parallel searches
])

// 4. Return only relevant entities (vs. ALL entities)
```

## Benefits of This Architecture

1. **Clear Flow:** Easy to understand the data flow from start to finish
2. **Modularity:** Each node is independent and can be modified separately
3. **Testability:** Each node can be tested in isolation
4. **Maintainability:** Changes to one step don't affect others
5. **Debugging:** Easy to add logging/monitoring at each step
6. **Extensibility:** New nodes can be added to the pipeline easily
7. **LLM-First Design:** Structure matches LLM workflow tools (LangChain, Dify)
8. **Cost Efficiency:** RAG reduces context size by ~75%, lowering OpenAI API costs significantly

## Dynamic Field Updates (Node 7)

The workflow includes automatic player field updates using LLM function calling:

### How It Works

1. **After generating the DM response**, Node 7 analyzes what happened
2. **Fetches player field definitions** from `world_player_fields` table
3. **Calls LLM with function/tool** to determine if fields should change
4. **LLM analyzes** the player action + DM response for mechanical changes
5. **If changes detected**, LLM calls `update_player_fields` tool with:
   - `field_name`: The field to update
   - `new_value`: The new value
   - `reason`: Why it's being updated (for debugging)
6. **Updates database** automatically with new field values

### Example Flow

```
Player: "I cast fireball at the goblin"
DM Response: "The fireball explodes, dealing 25 damage. The goblin falls..."

Node 7 Analysis:
- Detects spell usage
- Calls: update_player_fields([
    { field_name: "Mana", new_value: 35, reason: "Cast fireball (15 mana)" }
  ])
- Updates player.dynamic_fields.Mana: 50 → 35
```

### Conservative Approach

The LLM only updates fields when:
- There's a clear mechanical change (damage, resource usage, etc.)
- The change is explicitly described in the DM response
- It's confident about the exact value

This prevents accidental or speculative updates.

## RAG Configuration

Configuration for RAG retrieval can be adjusted in `nodes/rag-retrieval.ts`:

```typescript
export const RAG_CONFIG = {
  TOP_K: {
    items: 5,        // Top 5 most relevant items
    locations: 5,
    abilities: 5,
    npcs: 5,
    organizations: 5,
    taxonomies: 5,
    rules: 10,       // Rules may need more coverage
  },

  SIMILARITY_THRESHOLD: 0.65,  // 0-1, entities below this are filtered out

  ENABLE_RAG: {
    items: true,     // Set to false to disable RAG for specific entity type
    locations: true,
    // ...
  },
}
```

**Tuning Tips:**
- **Increase TOP_K** if responses lack necessary context
- **Decrease TOP_K** for faster responses and lower costs
- **Adjust SIMILARITY_THRESHOLD** to balance precision vs. recall
  - Higher (0.8+): Only very relevant entities, may miss context
  - Lower (0.5-0.6): More entities, but may include irrelevant ones

## Future Enhancements

Potential improvements to the workflow:

- ✅ **RAG retrieval** - Implemented! Semantic search for relevant entities
- Add **hybrid search** combining keyword + vector search
- Add **caching layer** for frequently accessed embeddings
- Add **post-processing node** to format/validate output
- Add **branching logic** for different types of player actions
- Add **retry logic** with exponential backoff for LLM calls
- Add **streaming support** for real-time response generation
- Add **monitoring/observability** hooks at each node
- Add **field update notifications** to show player what changed
- Add **validation** to prevent invalid field updates (e.g., negative health)

## Related Documentation

- [RAG_IMPLEMENTATION.md](../../../RAG_IMPLEMENTATION.md) - Complete RAG system guide
- [RAG_TESTING_CHECKLIST.md](../../../RAG_TESTING_CHECKLIST.md) - RAG testing procedures
