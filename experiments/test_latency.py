"""
Test latency difference between No RAG vs RAG
"""

import sys
sys.path.append('..')

from config import SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY, TEST_WORLD_NAME
from utils.rag_simulator import RAGSimulator
from supabase import create_client
from openai import OpenAI

# Initialize clients
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)

# Get world ID
world_response = supabase.table('worlds').select('id').eq('name', TEST_WORLD_NAME).single().execute()
WORLD_ID = world_response.data['id']

# Check entity counts
entity_types = ['items', 'abilities', 'npcs', 'rules']
print("Current entity counts:")
total_entities = 0
for entity_type in entity_types:
    response = supabase.table(entity_type).select('id', count='exact').eq('world_id', WORLD_ID).execute()
    count = response.count
    total_entities += count
    print(f"  {entity_type}: {count}")
print(f"  Total: {total_entities}\n")

# Initialize simulator
simulator = RAGSimulator(supabase, openai_client, WORLD_ID)

# Test scenario
test_message = "I want to attack the goblin with my sword"

print("=" * 60)
print("Testing latency difference...")
print("=" * 60)
print()

# Test No RAG
print("[1/3] Testing No RAG...")
no_rag_result = simulator.run_experiment(
    player_message=test_message,
    mode='no_rag'
)
print(f"  Input tokens: {no_rag_result['input_tokens']}")
print(f"  Output tokens: {no_rag_result['output_tokens']}")
print(f"  Total tokens: {no_rag_result['total_tokens']}")
print(f"  Latency: {no_rag_result['latency']:.2f}s")
print()

# Test Random
print("[2/3] Testing Random Sampling...")
random_result = simulator.run_experiment(
    player_message=test_message,
    mode='random',
    top_k=5
)
print(f"  Input tokens: {random_result['input_tokens']}")
print(f"  Output tokens: {random_result['output_tokens']}")
print(f"  Total tokens: {random_result['total_tokens']}")
print(f"  Latency: {random_result['latency']:.2f}s")
print()

# Test RAG
print("[3/3] Testing RAG...")
rag_result = simulator.run_experiment(
    player_message=test_message,
    mode='rag',
    top_k=5,
    similarity_threshold=0.65
)
print(f"  Input tokens: {rag_result['input_tokens']}")
print(f"  Output tokens: {rag_result['output_tokens']}")
print(f"  Total tokens: {rag_result['total_tokens']}")
print(f"  Latency: {rag_result['latency']:.2f}s")
print(f"  Entities retrieved: {rag_result['total_entities_retrieved']}")
print()

# Calculate differences
print("=" * 60)
print("Comparison Results:")
print("=" * 60)
print()

token_reduction = (no_rag_result['input_tokens'] - rag_result['input_tokens']) / no_rag_result['input_tokens'] * 100
latency_diff = no_rag_result['latency'] - rag_result['latency']
total_token_reduction = (no_rag_result['total_tokens'] - rag_result['total_tokens']) / no_rag_result['total_tokens'] * 100

print(f"Input token reduction (RAG vs No RAG): {token_reduction:.1f}%")
print(f"Total token reduction: {total_token_reduction:.1f}%")
print(f"Latency difference (No RAG - RAG): {latency_diff:+.2f}s")
print()

if latency_diff > 0:
    print("[OK] No RAG has higher latency than RAG")
    print(f"     Improvement: No RAG is {latency_diff:.2f}s slower")
elif latency_diff < -1:
    print("[WARNING] RAG latency is significantly higher than No RAG")
    print("This may indicate issues with the RAG retrieval process")
else:
    print("[OK] Latency is similar (within 1s)")
    print("This is acceptable - main benefit is token reduction")
