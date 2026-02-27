"""
Batch add entities to RAG Test World
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

def add_items():
    """Add items to 50"""
    items = [
        {"name": "Healing Potion", "description": "A red potion that restores 50 HP when consumed"},
        {"name": "Mana Potion", "description": "A blue potion that restores 30 mana points"},
        {"name": "Antidote", "description": "Cures poison and disease effects"},
        {"name": "Steel Armor", "description": "Heavy armor that provides +5 defense"},
        {"name": "Leather Boots", "description": "Light boots that increase movement speed"},
        {"name": "Magic Ring", "description": "A ring that increases magical power by 10%"},
        {"name": "Lockpick Set", "description": "A set of tools for picking locks"},
        {"name": "Rope (50ft)", "description": "Sturdy rope useful for climbing"},
        {"name": "Torch", "description": "Provides light in dark areas for 1 hour"},
        {"name": "Rations", "description": "Food supplies for one day"},
        {"name": "Elven Bow", "description": "A finely crafted bow with +3 accuracy"},
        {"name": "Dagger", "description": "A small, concealable weapon"},
        {"name": "Shield", "description": "Wooden shield that blocks attacks"},
        {"name": "Spellbook", "description": "Contains 5 random spell scrolls"},
        {"name": "Gold Coin Pouch", "description": "Contains 100 gold pieces"},
        {"name": "Compass", "description": "Always points north"},
        {"name": "Map of the Kingdom", "description": "Detailed map showing major cities and roads"},
        {"name": "Lantern", "description": "Oil lantern that burns for 6 hours"},
        {"name": "Grappling Hook", "description": "For climbing walls and crossing gaps"},
        {"name": "Tent", "description": "Provides shelter for camping"},
        {"name": "Bedroll", "description": "For comfortable rest"},
        {"name": "Waterskin", "description": "Holds 1 gallon of water"},
        {"name": "Flint and Steel", "description": "For starting fires"},
        {"name": "Holy Symbol", "description": "Channels divine magic"},
        {"name": "Thieves' Tools", "description": "Professional lockpicking and trap disabling tools"},
        {"name": "Crowbar", "description": "For prying open doors and chests"},
        {"name": "Hammer", "description": "Useful for crafting and breaking"},
        {"name": "Piton", "description": "Metal spike for climbing"},
        {"name": "Mirror", "description": "Small handheld mirror"},
        {"name": "Chalk", "description": "For marking paths in dungeons"},
        {"name": "Hourglass", "description": "Measures one hour of time"},
        {"name": "Bell", "description": "Makes noise to alert or signal"},
        {"name": "Whistle", "description": "High-pitched whistle for signaling"},
        {"name": "Chain (10ft)", "description": "Strong metal chain"},
        {"name": "Manacles", "description": "Iron restraints for prisoners"},
        {"name": "Potion of Invisibility", "description": "Grants invisibility for 10 minutes"},
        {"name": "Potion of Strength", "description": "Increases strength by 5 for 1 hour"},
        {"name": "Scroll of Lightning", "description": "Single-use spell that deals 30 damage"},
        {"name": "Enchanted Amulet", "description": "Protects against fire damage"},
        {"name": "Cursed Ring", "description": "Cannot be removed once worn, -1 to all stats"},
        {"name": "Crystal Ball", "description": "Used for divination magic"},
        {"name": "Wand of Magic Missiles", "description": "Shoots 3 magic missiles, recharges daily"},
        {"name": "Staff of Healing", "description": "Casts heal spell 5 times per day"},
        {"name": "Cloak of Shadows", "description": "Grants advantage on stealth checks"},
        {"name": "Boots of Speed", "description": "Doubles movement speed for 1 minute"},
        {"name": "Gauntlets of Ogre Strength", "description": "Sets strength to 19"},
        {"name": "Helm of Telepathy", "description": "Read surface thoughts of creatures"},
        {"name": "Bag of Holding", "description": "Can store up to 500 lbs without weight"},
        {"name": "Potion of Flying", "description": "Grants flight for 1 hour"},
        {"name": "Dragon Scale Mail", "description": "Legendary armor with +10 defense and fire resistance"}
    ]

    print(f"Adding {len(items)} items...")
    for i, item in enumerate(items):
        text = f"{item['name']} {item['description']}"
        embedding = generate_embedding(text)

        data = {
            "world_id": WORLD_ID,
            "name": item["name"],
            "description": item["description"],
            "embedding": embedding
        }

        supabase.table('items').insert(data).execute()
        print(f"  [{i+1}/{len(items)}] Added: {item['name']}")
        time.sleep(0.2)  # Rate limiting

    print(f"[OK] Added {len(items)} items\n")

def add_abilities():
    """Add abilities to 50"""
    abilities = [
        {"name": "Stealth", "description": "Move silently and hide in shadows"},
        {"name": "Lockpicking", "description": "Open locks without keys"},
        {"name": "Archery", "description": "Skilled with bows and crossbows"},
        {"name": "Two-Handed Combat", "description": "Wield large weapons effectively"},
        {"name": "Dual Wielding", "description": "Fight with a weapon in each hand"},
        {"name": "Shield Bash", "description": "Stun enemies with your shield"},
        {"name": "Backstab", "description": "Deal extra damage from behind"},
        {"name": "Pickpocket", "description": "Steal items from others unnoticed"},
        {"name": "Intimidation", "description": "Frighten enemies into submission"},
        {"name": "Persuasion", "description": "Convince others through charm"},
        {"name": "Deception", "description": "Lie convincingly"},
        {"name": "Investigation", "description": "Find hidden clues and objects"},
        {"name": "Acrobatics", "description": "Perform agile maneuvers"},
        {"name": "Athletics", "description": "Climbing, jumping, swimming"},
        {"name": "Survival", "description": "Track, forage, and navigate wilderness"},
        {"name": "Animal Handling", "description": "Calm and train animals"},
        {"name": "Medicine", "description": "Heal wounds and cure diseases"},
        {"name": "Herbalism", "description": "Create potions from plants"},
        {"name": "Alchemy", "description": "Brew magical elixirs"},
        {"name": "Enchanting", "description": "Imbue items with magic"},
        {"name": "Smithing", "description": "Craft weapons and armor"},
        {"name": "Cooking", "description": "Prepare nourishing meals"},
        {"name": "Ice Bolt", "description": "Launch a freezing projectile"},
        {"name": "Chain Lightning", "description": "Lightning that bounces between targets"},
        {"name": "Meteor Strike", "description": "Summon a falling meteor"},
        {"name": "Healing Touch", "description": "Restore HP with a touch"},
        {"name": "Divine Shield", "description": "Become invulnerable for 5 seconds"},
        {"name": "Resurrection", "description": "Bring a fallen ally back to life"},
        {"name": "Summon Familiar", "description": "Call forth a magical companion"},
        {"name": "Teleportation", "description": "Instantly move to a visible location"},
        {"name": "Time Stop", "description": "Freeze time for 6 seconds"},
        {"name": "Invisibility", "description": "Become unseen for 1 minute"},
        {"name": "Mind Control", "description": "Dominate an enemy's will"},
        {"name": "Fear", "description": "Cause enemies to flee in terror"},
        {"name": "Sleep", "description": "Put creatures into magical slumber"},
        {"name": "Dispel Magic", "description": "Remove magical effects"},
        {"name": "Detect Magic", "description": "See magical auras"},
        {"name": "Identify", "description": "Learn properties of magic items"},
        {"name": "Levitation", "description": "Float above the ground"},
        {"name": "Feather Fall", "description": "Slow your descent when falling"},
        {"name": "Water Breathing", "description": "Breathe underwater"},
        {"name": "Darkvision", "description": "See in complete darkness"},
        {"name": "Spider Climb", "description": "Walk on walls and ceilings"},
        {"name": "Haste", "description": "Double your speed and actions"},
        {"name": "Slow", "description": "Halve enemy speed and reactions"},
        {"name": "Polymorph", "description": "Transform into another creature"},
        {"name": "Scrying", "description": "View distant locations"},
        {"name": "Speak with Dead", "description": "Question a corpse"},
        {"name": "Speak with Animals", "description": "Communicate with beasts"},
        {"name": "Comprehend Languages", "description": "Understand any spoken language"}
    ]

    print(f"Adding {len(abilities)} abilities...")
    for i, ability in enumerate(abilities):
        text = f"{ability['name']} {ability['description']}"
        embedding = generate_embedding(text)

        data = {
            "world_id": WORLD_ID,
            "name": ability["name"],
            "description": ability["description"],
            "embedding": embedding
        }

        supabase.table('abilities').insert(data).execute()
        print(f"  [{i+1}/{len(abilities)}] Added: {ability['name']}")
        time.sleep(0.2)

    print(f"[OK] Added {len(abilities)} abilities\n")

def add_npcs():
    """Add NPCs to 50"""
    npcs = [
        {"name": "Marcus the Blacksmith", "description": "A burly dwarf who forges the finest weapons in town"},
        {"name": "Elara the Herbalist", "description": "An elderly elf who knows all healing herbs"},
        {"name": "Captain Thorne", "description": "Leader of the city guard, strict but fair"},
        {"name": "Mysterious Hooded Figure", "description": "A shadowy person who deals in secrets"},
        {"name": "Tavern Keeper Bran", "description": "Friendly innkeeper who hears all the rumors"},
        {"name": "Sage Aldric", "description": "Ancient wizard who studies forbidden knowledge"},
        {"name": "Thief Guildmaster Raven", "description": "Cunning leader of the underground thieves"},
        {"name": "High Priestess Seraphina", "description": "Devout cleric who leads temple services"},
        {"name": "Merchant Lord Goldwyn", "description": "Wealthy trader who sells rare goods"},
        {"name": "Stable Master Hans", "description": "Takes care of horses and mounts"},
        {"name": "Street Urchin Pip", "description": "Young orphan who knows city secrets"},
        {"name": "Noble Lady Vivienne", "description": "Aristocrat with political connections"},
        {"name": "Court Jester Fool", "description": "Entertainer who speaks truth through jokes"},
        {"name": "Executioner Grimm", "description": "Hooded figure who carries out sentences"},
        {"name": "Librarian Quill", "description": "Keeper of ancient tomes and scrolls"},
        {"name": "Bard Melody", "description": "Traveling musician who sings of adventures"},
        {"name": "Bounty Hunter Scar", "description": "Ruthless tracker who hunts criminals"},
        {"name": "Caravan Master Ibn", "description": "Leads trade expeditions across desert"},
        {"name": "Oracle Cassandra", "description": "Seer who speaks cryptic prophecies"},
        {"name": "Dragon Cultist Malakai", "description": "Fanatic who worships ancient dragons"},
        {"name": "Resistance Leader Kira", "description": "Fights against tyrannical rule"},
        {"name": "Mad Scientist Viktor", "description": "Creates strange magical constructs"},
        {"name": "Gladiator Champion Rex", "description": "Undefeated fighter in the arena"},
        {"name": "Poison Dealer Vex", "description": "Sells toxins and antidotes in alleys"},
        {"name": "Beast Tamer Zara", "description": "Controls dangerous wild creatures"},
        {"name": "Necromancer Mortis", "description": "Raises and commands undead minions"},
        {"name": "Paladin Sir Galahad", "description": "Holy knight sworn to justice"},
        {"name": "Assassin Nightshade", "description": "Silent killer for hire"},
        {"name": "Pirate Captain Redbeard", "description": "Sails the seas plundering ships"},
        {"name": "Vampire Lord Dravin", "description": "Ancient bloodsucker ruling from castle"},
        {"name": "Werewolf Alpha Fenris", "description": "Leader of lycanthrope pack"},
        {"name": "Fairy Queen Titania", "description": "Ruler of the enchanted forest"},
        {"name": "Giant King Thokk", "description": "Massive leader of mountain giants"},
        {"name": "Demon Prince Asmodeus", "description": "Fiendish entity from lower planes"},
        {"name": "Angel Celestia", "description": "Divine messenger from heavens"},
        {"name": "Archmage Zephyr", "description": "Master of elemental magic"},
        {"name": "Druid Oakenshield", "description": "Protector of natural balance"},
        {"name": "Monk Master Li", "description": "Teaches martial arts discipline"},
        {"name": "Ranger Strider", "description": "Expert wilderness scout and tracker"},
        {"name": "Warlock Raven", "description": "Bound to eldritch patron entity"},
        {"name": "Sorcerer Pyra", "description": "Born with innate fire magic"},
        {"name": "Artificer Gizmo", "description": "Creates magical mechanical devices"},
        {"name": "Cleric Father Benedict", "description": "Heals sick and tends poor"},
        {"name": "Fighter Goliath", "description": "Massive warrior with great sword"},
        {"name": "Rogue Whisper", "description": "Stealthy spy and infiltrator"},
        {"name": "Barbarian Grog", "description": "Rage-fueled tribal warrior"},
        {"name": "Enchantress Morgana", "description": "Weaves illusions and charms"},
        {"name": "Alchemist Gregor", "description": "Experiments with transmutation"},
        {"name": "Cartographer Felix", "description": "Maps unknown territories"},
        {"name": "Historian Cornelius", "description": "Studies ancient civilizations"}
    ]

    print(f"Adding {len(npcs)} NPCs...")
    for i, npc in enumerate(npcs):
        text = f"{npc['name']} {npc['description']}"
        embedding = generate_embedding(text)

        data = {
            "world_id": WORLD_ID,
            "name": npc["name"],
            "description": npc["description"],
            "embedding": embedding
        }

        supabase.table('npcs').insert(data).execute()
        print(f"  [{i+1}/{len(npcs)}] Added: {npc['name']}")
        time.sleep(0.2)

    print(f"[OK] Added {len(npcs)} NPCs\n")

def add_rules():
    """Add rules to 50"""
    rules = [
        {"name": "Combat Initiative", "description": "At the start of combat, all participants roll for initiative to determine turn order", "is_high_priority": True},
        {"name": "Attack Rolls", "description": "To hit a target, roll 1d20 + attack bonus vs target's armor class", "is_high_priority": True},
        {"name": "Damage Calculation", "description": "On successful hit, roll weapon damage dice and add relevant modifiers", "is_high_priority": True},
        {"name": "Death and Dying", "description": "At 0 HP, character falls unconscious and makes death saving throws", "is_high_priority": True},
        {"name": "Healing", "description": "HP can be restored through potions, spells, or rest", "is_high_priority": True},
        {"name": "Spell Casting", "description": "Casting spells consumes mana and requires line of sight", "is_high_priority": True},
        {"name": "Advantage/Disadvantage", "description": "Roll twice and take higher/lower result", "is_high_priority": True},
        {"name": "Critical Hits", "description": "Natural 20 on attack roll doubles damage dice", "is_high_priority": True},
        {"name": "Critical Failures", "description": "Natural 1 on attack roll is automatic miss", "is_high_priority": True},
        {"name": "Skill Checks", "description": "Roll 1d20 + skill modifier vs difficulty class", "is_high_priority": True},
        {"name": "Movement", "description": "Characters can move their speed in feet per turn", "is_high_priority": False},
        {"name": "Opportunity Attacks", "description": "Moving away from enemy provokes free attack", "is_high_priority": True},
        {"name": "Cover", "description": "Partial cover grants +2 AC, full cover grants +5 AC", "is_high_priority": False},
        {"name": "Flanking", "description": "Attacking from opposite sides grants advantage", "is_high_priority": False},
        {"name": "Surprise", "description": "Unaware creatures cannot act in first round", "is_high_priority": False},
        {"name": "Concentration", "description": "Some spells require concentration, broken by damage", "is_high_priority": True},
        {"name": "Resting", "description": "Short rest restores some HP, long rest fully heals", "is_high_priority": False},
        {"name": "Carrying Capacity", "description": "Can carry up to Strength x 15 pounds", "is_high_priority": False},
        {"name": "Visibility", "description": "Darkness imposes disadvantage on perception", "is_high_priority": False},
        {"name": "Stealth", "description": "Hidden creatures have advantage on attacks", "is_high_priority": False},
        {"name": "Climbing", "description": "Climbing costs 2 feet of movement per foot climbed", "is_high_priority": False},
        {"name": "Swimming", "description": "Swimming costs 2 feet of movement per foot swun", "is_high_priority": False},
        {"name": "Jumping", "description": "Long jump distance equals Strength score in feet", "is_high_priority": False},
        {"name": "Fall Damage", "description": "Take 1d6 damage per 10 feet fallen", "is_high_priority": False},
        {"name": "Suffocation", "description": "Can hold breath for 1 + Con modifier minutes", "is_high_priority": False},
        {"name": "Poison", "description": "Poisoned creatures have disadvantage on attacks and checks", "is_high_priority": False},
        {"name": "Disease", "description": "Diseases impose various penalties over time", "is_high_priority": False},
        {"name": "Exhaustion", "description": "6 levels of exhaustion with cumulative penalties", "is_high_priority": False},
        {"name": "Grappling", "description": "Contest Athletics vs Athletics or Acrobatics", "is_high_priority": False},
        {"name": "Shoving", "description": "Contest Athletics vs Athletics or Acrobatics to push", "is_high_priority": False},
        {"name": "Two-Weapon Fighting", "description": "Attack with bonus action using off-hand weapon", "is_high_priority": False},
        {"name": "Mounted Combat", "description": "Control mount with action or let it act independently", "is_high_priority": False},
        {"name": "Underwater Combat", "description": "Melee attacks have disadvantage unless using piercing", "is_high_priority": False},
        {"name": "Vision Types", "description": "Darkvision sees 60ft in darkness as dim light", "is_high_priority": False},
        {"name": "Languages", "description": "Creatures can speak their racial languages", "is_high_priority": False},
        {"name": "Magic Items", "description": "Attunement required for some items, max 3 attuned", "is_high_priority": False},
        {"name": "Identify Items", "description": "Spend short rest examining to learn properties", "is_high_priority": False},
        {"name": "Selling Items", "description": "Items sell for 50% of purchase price", "is_high_priority": False},
        {"name": "Experience Points", "description": "Defeating enemies grants XP for leveling", "is_high_priority": False},
        {"name": "Level Up", "description": "Gain HP, abilities, and stat increases at new level", "is_high_priority": False},
        {"name": "Alignment", "description": "Character moral compass: Good, Neutral, Evil / Lawful, Neutral, Chaotic", "is_high_priority": False},
        {"name": "Inspiration", "description": "Reward for good roleplay, spend for advantage", "is_high_priority": False},
        {"name": "Death Saving Throws", "description": "Roll d20: 10+ success, 1-9 failure, 3 of either determines fate", "is_high_priority": True},
        {"name": "Stabilizing", "description": "Medicine check DC 10 to stabilize dying creature", "is_high_priority": True},
        {"name": "Resurrection", "description": "Powerful magic can bring back the dead", "is_high_priority": False},
        {"name": "Multiclassing", "description": "Can gain levels in multiple classes", "is_high_priority": False},
        {"name": "Feats", "description": "Special abilities gained instead of stat increases", "is_high_priority": False},
        {"name": "Reactions", "description": "One reaction per round, triggered by specific events", "is_high_priority": True},
        {"name": "Bonus Actions", "description": "One bonus action per turn, specific abilities only", "is_high_priority": True},
        {"name": "Free Actions", "description": "Drop items, speak briefly without using action", "is_high_priority": False}
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
    print("=" * 60)
    print("Starting entity expansion...")
    print("=" * 60)
    print()

    add_items()
    add_abilities()
    add_npcs()
    add_rules()

    print("=" * 60)
    print("All entities added successfully!")
    print("=" * 60)
