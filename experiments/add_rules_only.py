"""
Add rules only to RAG Test World
"""

import sys
sys.path.append('..')

from config import SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY, TEST_WORLD_NAME
from supabase import create_client
from openai import OpenAI
import time

# Connect to Supabase and OpenAI
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)

# Get test world ID
world_response = supabase.table('worlds').select('id').eq('name', TEST_WORLD_NAME).single().execute()
WORLD_ID = world_response.data['id']

print(f"World ID: {WORLD_ID}\n")

def generate_embedding(text):
    """Generate embedding for text"""
    response = openai_client.embeddings.create(
        model="text-embedding-ada-002",
        input=text
    )
    return response.data[0].embedding

def add_rules():
    """Add rules to 50"""
    rules = [
        {"name": "Combat Initiative", "description": "At the start of combat, all participants roll for initiative to determine turn order"},
        {"name": "Attack Rolls", "description": "To hit a target, roll 1d20 + attack bonus vs target's armor class"},
        {"name": "Damage Calculation", "description": "On successful hit, roll weapon damage dice and add relevant modifiers"},
        {"name": "Death and Dying", "description": "At 0 HP, character falls unconscious and makes death saving throws"},
        {"name": "Healing", "description": "HP can be restored through potions, spells, or rest"},
        {"name": "Spell Casting", "description": "Casting spells consumes mana and requires line of sight"},
        {"name": "Advantage/Disadvantage", "description": "Roll twice and take higher/lower result"},
        {"name": "Critical Hits", "description": "Natural 20 on attack roll doubles damage dice"},
        {"name": "Critical Failures", "description": "Natural 1 on attack roll is automatic miss"},
        {"name": "Skill Checks", "description": "Roll 1d20 + skill modifier vs difficulty class"},
        {"name": "Movement", "description": "Characters can move their speed in feet per turn"},
        {"name": "Opportunity Attacks", "description": "Moving away from enemy provokes free attack"},
        {"name": "Cover", "description": "Partial cover grants +2 AC, full cover grants +5 AC"},
        {"name": "Flanking", "description": "Attacking from opposite sides grants advantage"},
        {"name": "Surprise", "description": "Unaware creatures cannot act in first round"},
        {"name": "Concentration", "description": "Some spells require concentration, broken by damage"},
        {"name": "Resting", "description": "Short rest restores some HP, long rest fully heals"},
        {"name": "Carrying Capacity", "description": "Can carry up to Strength x 15 pounds"},
        {"name": "Visibility", "description": "Darkness imposes disadvantage on perception"},
        {"name": "Stealth", "description": "Hidden creatures have advantage on attacks"},
        {"name": "Climbing", "description": "Climbing costs 2 feet of movement per foot climbed"},
        {"name": "Swimming", "description": "Swimming costs 2 feet of movement per foot swum"},
        {"name": "Jumping", "description": "Long jump distance equals Strength score in feet"},
        {"name": "Fall Damage", "description": "Take 1d6 damage per 10 feet fallen"},
        {"name": "Suffocation", "description": "Can hold breath for 1 + Con modifier minutes"},
        {"name": "Poison", "description": "Poisoned creatures have disadvantage on attacks and checks"},
        {"name": "Disease", "description": "Diseases impose various penalties over time"},
        {"name": "Exhaustion", "description": "6 levels of exhaustion with cumulative penalties"},
        {"name": "Grappling", "description": "Contest Athletics vs Athletics or Acrobatics"},
        {"name": "Shoving", "description": "Contest Athletics vs Athletics or Acrobatics to push"},
        {"name": "Two-Weapon Fighting", "description": "Attack with bonus action using off-hand weapon"},
        {"name": "Mounted Combat", "description": "Control mount with action or let it act independently"},
        {"name": "Underwater Combat", "description": "Melee attacks have disadvantage unless using piercing"},
        {"name": "Vision Types", "description": "Darkvision sees 60ft in darkness as dim light"},
        {"name": "Languages", "description": "Creatures can speak their racial languages"},
        {"name": "Magic Items", "description": "Attunement required for some items, max 3 attuned"},
        {"name": "Identify Items", "description": "Spend short rest examining to learn properties"},
        {"name": "Selling Items", "description": "Items sell for 50% of purchase price"},
        {"name": "Experience Points", "description": "Defeating enemies grants XP for leveling"},
        {"name": "Level Up", "description": "Gain HP, abilities, and stat increases at new level"},
        {"name": "Alignment", "description": "Character moral compass: Good, Neutral, Evil / Lawful, Neutral, Chaotic"},
        {"name": "Inspiration", "description": "Reward for good roleplay, spend for advantage"},
        {"name": "Death Saving Throws", "description": "Roll d20: 10+ success, 1-9 failure, 3 of either determines fate"},
        {"name": "Stabilizing", "description": "Medicine check DC 10 to stabilize dying creature"},
        {"name": "Resurrection", "description": "Powerful magic can bring back the dead"},
        {"name": "Multiclassing", "description": "Can gain levels in multiple classes"},
        {"name": "Feats", "description": "Special abilities gained instead of stat increases"},
        {"name": "Reactions", "description": "One reaction per round, triggered by specific events"},
        {"name": "Bonus Actions", "description": "One bonus action per turn, specific abilities only"},
        {"name": "Free Actions", "description": "Drop items, speak briefly without using action"}
    ]

    print(f"Adding {len(rules)} rules...")
    for i, rule in enumerate(rules):
        text = f"{rule['name']} {rule['description']}"
        embedding = generate_embedding(text)

        data = {
            "world_id": WORLD_ID,
            "name": rule["name"],
            "description": rule["description"],
            "embedding": embedding
        }

        supabase.table('rules').insert(data).execute()
        print(f"  [{i+1}/{len(rules)}] Added: {rule['name']}")
        time.sleep(0.2)

    print(f"[OK] Added {len(rules)} rules\n")

if __name__ == "__main__":
    add_rules()
    print("Rules added successfully!")
