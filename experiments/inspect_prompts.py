"""
Inspect actual prompt differences between No RAG vs RAG
"""

import sys
sys.path.append('..')

from config import SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY, TEST_WORLD_NAME
from utils.rag_simulator import RAGSimulator
from supabase import create_client
from openai import OpenAI

# Initialize
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)
world_response = supabase.table('worlds').select('id').eq('name', TEST_WORLD_NAME).single().execute()
WORLD_ID = world_response.data['id']
simulator = RAGSimulator(supabase, openai_client, WORLD_ID)

test_message = "I want to attack the goblin with my sword"

# Get world info
world_info = world_response.data

print("=" * 80)
print("Inspecting No RAG vs RAG prompt differences")
print("=" * 80)
print()

# 1. No RAG
print("[1/3] No RAG - Retrieving all entities...")
all_entities = simulator.retrieve_all_entities()
no_rag_context = simulator.assemble_context(all_entities, world_info)

print(f"Entity statistics:")
for entity_type, entities in all_entities.items():
    print(f"  {entity_type}: {len(entities)}")
print(f"Context length: {len(no_rag_context)} characters")
print(f"Context first 500 characters:")
print(no_rag_context[:500])
print("...\n")

# 2. Random
print("[2/3] Random - Random sampling 5 entities...")
random_entities = simulator.retrieve_random_entities(k=5)
random_context = simulator.assemble_context(random_entities, world_info)

print(f"Entity statistics:")
for entity_type, entities in random_entities.items():
    print(f"  {entity_type}: {len(entities)}")
print(f"Context length: {len(random_context)} characters")
print(f"Context first 500 characters:")
print(random_context[:500])
print("...\n")

# 3. RAG
print("[3/3] RAG - Semantic retrieval of relevant entities...")
query_embedding = simulator.generate_query_embedding(test_message)
rag_entities = simulator.retrieve_with_rag(query_embedding, top_k=5, similarity_threshold=0.65)
rag_context = simulator.assemble_context(rag_entities, world_info)

print(f"Entity statistics:")
for entity_type, entities in rag_entities.items():
    print(f"  {entity_type}: {len(entities)}")
print(f"Context length: {len(rag_context)} characters")
print(f"Context first 500 characters:")
print(rag_context[:500])
print("...\n")

# 4. Comparison
print("=" * 80)
print("Comparison Results:")
print("=" * 80)
print(f"No RAG context: {len(no_rag_context)} characters")
print(f"Random context:  {len(random_context)} characters")
print(f"RAG context:     {len(rag_context)} characters")
print()
print(f"Context reduction (No RAG -> RAG): {(1 - len(rag_context)/len(no_rag_context))*100:.1f}%")
print()

# 5. System prompt is the same across all modes
system_prompt = """You are an experienced and objective game master for a tabletop role-playing game.

DM Guidelines:
- Acknowledge player actions with logical consequences
- Provide immersive, vivid descriptions
- Avoid describing player emotions (only environmental effects)
- Use objective narration without meta-commentary
- Refer to unknown entities descriptively, not by name
- Proactively advance the story to decision points"""

print("System Prompt (same for all modes):")
print(system_prompt)
print()

print("User Prompt structure (same for all modes):")
print(f'''{{context}}

Player Action: "{test_message}"

Generate an engaging DM response based on the world context and player action.''')
print()
print("✅ Conclusion: The ONLY difference in prompts is the entity list in the context!")
