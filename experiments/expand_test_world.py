"""
Expand RAG Test World entity count
Goal: items, NPCs, abilities, rules all reach at least 50
"""

import sys
sys.path.append('..')

from config import SUPABASE_URL, SUPABASE_ANON_KEY, TEST_WORLD_NAME
from supabase import create_client
import json

# Connect to Supabase
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# Get test world ID
print("Connecting to Supabase...")
world_response = supabase.table('worlds')\
    .select('id, name, description')\
    .eq('name', TEST_WORLD_NAME)\
    .single()\
    .execute()

test_world = world_response.data
WORLD_ID = test_world['id']

print(f"[OK] Found test world: {test_world['name']}")
print(f"World ID: {WORLD_ID}")
print(f"Description: {test_world['description']}\n")

# Check current entity counts
entity_types = ['items', 'abilities', 'npcs', 'rules']
current_counts = {}

for entity_type in entity_types:
    response = supabase.table(entity_type)\
        .select('*')\
        .eq('world_id', WORLD_ID)\
        .execute()
    current_counts[entity_type] = len(response.data)
    print(f"{entity_type}: {len(response.data)} items")

    # Print first 2 examples to understand format
    if len(response.data) > 0:
        print(f"  Example: {response.data[0]['name']}")
        if len(response.data) > 1:
            print(f"  Example: {response.data[1]['name']}")
    print()

print("\nCurrent total entities:", sum(current_counts.values()))
print("Goal: At least 50 per category")
