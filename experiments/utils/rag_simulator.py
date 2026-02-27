"""
RAG Simulator - Simulates the RAG process of the real system
Does not depend on actual API, directly calls database and OpenAI
"""

import time
from typing import List, Dict, Any, Optional
from openai import OpenAI
from supabase import Client as SupabaseClient
import random


class RAGSimulator:
    """Simulate RAG retrieval and response generation process"""

    def __init__(
        self,
        supabase: SupabaseClient,
        openai_client: OpenAI,
        world_id: str
    ):
        self.supabase = supabase
        self.openai = openai_client
        self.world_id = world_id

    def generate_query_embedding(self, text: str) -> List[float]:
        """Generate embedding vector for query"""
        response = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding

    def retrieve_with_rag(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        similarity_threshold: float = 0.65
    ) -> Dict[str, List[Dict]]:
        """Retrieve relevant entities using RAG"""

        results = {}
        entity_types = {
            'items': top_k,
            'abilities': top_k,
            'locations': top_k,
            'npcs': top_k,
            'organizations': min(top_k, 3),
            'taxonomies': min(top_k, 3),
            'rules': max(top_k, 10)
        }

        for entity_type, limit in entity_types.items():
            try:
                # Call database's match_* function
                function_name = f'match_{entity_type}'
                response = self.supabase.rpc(
                    function_name,
                    {
                        'query_embedding': query_embedding,
                        'world_id': self.world_id,
                        'match_count': limit,
                        'match_threshold': similarity_threshold
                    }
                ).execute()

                results[entity_type] = response.data if response.data else []
            except Exception as e:
                print(f"Warning: Failed to retrieve {entity_type}: {e}")
                results[entity_type] = []

        return results

    def retrieve_all_entities(self) -> Dict[str, List[Dict]]:
        """Full retrieval of all entities (No RAG baseline)"""

        results = {}
        entity_types = ['items', 'abilities', 'locations', 'npcs',
                       'organizations', 'taxonomies', 'rules']

        for entity_type in entity_types:
            try:
                response = self.supabase.table(entity_type)\
                    .select('*')\
                    .eq('world_id', self.world_id)\
                    .execute()

                results[entity_type] = response.data if response.data else []
            except Exception as e:
                print(f"Warning: Failed to retrieve {entity_type}: {e}")
                results[entity_type] = []

        return results

    def retrieve_random_entities(self, k: int = 5) -> Dict[str, List[Dict]]:
        """Random sampling of entities (Random Sampling baseline)"""

        # First get all entities
        all_entities = self.retrieve_all_entities()

        # Random sampling
        results = {}
        for entity_type, entities in all_entities.items():
            if entity_type == 'rules':
                # Take more rules
                sample_size = min(len(entities), max(k, 10))
            else:
                sample_size = min(len(entities), k)

            results[entity_type] = random.sample(entities, sample_size) if entities else []

        return results

    def assemble_context(
        self,
        entities: Dict[str, List[Dict]],
        world_info: Dict,
        player_info: Optional[Dict] = None
    ) -> str:
        """Assemble context string"""

        context_parts = []

        # World setting
        context_parts.append(f"=== WORLD SETTING ===")
        context_parts.append(f"Name: {world_info.get('name', 'Unknown')}")
        context_parts.append(f"Tone: {world_info.get('tone', 'neutral')}")
        context_parts.append(f"Setting: {world_info.get('setting', '')}")
        context_parts.append(f"Description: {world_info.get('description', '')}")
        context_parts.append("")

        # Items
        if entities.get('items'):
            context_parts.append("=== ITEMS ===")
            for item in entities['items']:
                context_parts.append(f"- {item['name']}: {item.get('description', '')}")
            context_parts.append("")

        # Abilities
        if entities.get('abilities'):
            context_parts.append("=== ABILITIES ===")
            for ability in entities['abilities']:
                context_parts.append(f"- {ability['name']}: {ability.get('description', '')}")
            context_parts.append("")

        # Locations
        if entities.get('locations'):
            context_parts.append("=== LOCATIONS ===")
            for location in entities['locations']:
                context_parts.append(f"- {location['name']}: {location.get('description', '')}")
            context_parts.append("")

        # NPCs
        if entities.get('npcs'):
            context_parts.append("=== NPCs ===")
            for npc in entities['npcs']:
                context_parts.append(f"- {npc['name']}: {npc.get('description', '')}")
            context_parts.append("")

        # Rules
        if entities.get('rules'):
            context_parts.append("=== RULES ===")
            for rule in entities['rules']:
                priority = "[HIGH PRIORITY] " if rule.get('is_priority') else ""
                context_parts.append(f"- {priority}{rule['name']}: {rule.get('description', '')}")
            context_parts.append("")

        return "\n".join(context_parts)

    def generate_dm_response(
        self,
        context: str,
        player_message: str,
        temperature: float = 0.8,
        max_tokens: int = 1000
    ) -> Dict[str, Any]:
        """Call GPT-4 to generate DM response"""

        system_prompt = """You are an experienced and objective game master for a tabletop role-playing game.

DM Guidelines:
- Acknowledge player actions with logical consequences
- Provide immersive, vivid descriptions
- Avoid describing player emotions (only environmental effects)
- Use objective narration without meta-commentary
- Refer to unknown entities descriptively, not by name
- Proactively advance the story to decision points"""

        user_prompt = f"""{context}

Player Action: "{player_message}"

Generate an engaging DM response based on the world context and player action."""

        start_time = time.time()

        response = self.openai.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens
        )

        latency = time.time() - start_time

        return {
            'response_text': response.choices[0].message.content,
            'input_tokens': response.usage.prompt_tokens,
            'output_tokens': response.usage.completion_tokens,
            'total_tokens': response.usage.total_tokens,
            'latency': latency,
            'model': 'gpt-4'
        }

    def run_experiment(
        self,
        player_message: str,
        mode: str = 'rag',  # 'rag', 'no_rag', 'random'
        top_k: int = 5,
        similarity_threshold: float = 0.65,
        temperature: float = 0.8
    ) -> Dict[str, Any]:
        """Run one complete experiment"""

        # 1. Get world info
        world_response = self.supabase.table('worlds')\
            .select('*')\
            .eq('id', self.world_id)\
            .single()\
            .execute()
        world_info = world_response.data

        # 2. Retrieve entities
        if mode == 'rag':
            # RAG retrieval
            query_embedding = self.generate_query_embedding(player_message)
            entities = self.retrieve_with_rag(
                query_embedding,
                top_k=top_k,
                similarity_threshold=similarity_threshold
            )
        elif mode == 'no_rag':
            # Full retrieval
            entities = self.retrieve_all_entities()
        elif mode == 'random':
            # Random sampling
            entities = self.retrieve_random_entities(k=top_k)
        else:
            raise ValueError(f"Unknown mode: {mode}")

        # 3. Assemble context
        context = self.assemble_context(entities, world_info)

        # 4. Generate response
        generation_result = self.generate_dm_response(
            context,
            player_message,
            temperature=temperature
        )

        # 5. Calculate context size
        context_tokens = len(context.split())  # Rough estimate

        # 6. Count retrieved entities
        entity_counts = {
            entity_type: len(entity_list)
            for entity_type, entity_list in entities.items()
        }

        return {
            'mode': mode,
            'player_message': player_message,
            'context': context,
            'context_size_tokens': context_tokens,
            'entity_counts': entity_counts,
            'total_entities_retrieved': sum(entity_counts.values()),
            'response_text': generation_result['response_text'],
            'input_tokens': generation_result['input_tokens'],
            'output_tokens': generation_result['output_tokens'],
            'total_tokens': generation_result['total_tokens'],
            'latency': generation_result['latency'],
            'temperature': temperature,
            'top_k': top_k,
            'similarity_threshold': similarity_threshold
        }
