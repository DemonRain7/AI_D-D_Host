"""
RAG Experiment Configuration File
Contains all experiment parameters and database connection configurations
"""

import os
from dataclasses import dataclass
from typing import Dict, List

# ==================== Database Configuration ====================
SUPABASE_URL = ""
SUPABASE_ANON_KEY = ""
OPENAI_API_KEY = ""

# Test world name
TEST_WORLD_NAME = "RAG Test World"

# ==================== Experiment Configuration ====================

# Number of runs per configuration
RUNS_PER_CONFIG = 3

# OpenAI model configuration
OPENAI_MODEL = "gpt-4.1"  # More affordable model
EMBEDDING_MODEL = "text-embedding-ada-002"

# ==================== Baseline Configuration ====================

@dataclass
class BaselineConfig:
    """Baseline configuration"""
    name: str
    description: str
    use_rag: bool
    random_sampling: bool
    top_k: int = 5
    similarity_threshold: float = 0.65

BASELINE_CONFIGS = {
    "no_rag": BaselineConfig(
        name="Baseline 1: No RAG",
        description="Pass all world entities (full retrieval)",
        use_rag=False,
        random_sampling=False,
    ),
    "random_sampling": BaselineConfig(
        name="Baseline 2: Random Sampling",
        description="Randomly select k entities",
        use_rag=False,
        random_sampling=True,
        top_k=5,
    ),
    "rag": BaselineConfig(
        name="LLM-GM: RAG",
        description="Semantic similarity retrieval",
        use_rag=True,
        random_sampling=False,
        top_k=5,
        similarity_threshold=0.65,
    ),
}

# ==================== Ablation Experiment Configuration ====================

# RAG threshold ablation
RAG_THRESHOLD_VALUES = [0.5, 0.65, 0.8]

# TOP_K ablation
TOP_K_VALUES = [3, 5, 10]

# Temperature ablation
TEMPERATURE_VALUES = [0.5, 0.8, 1.0]

# Function Calling ablation
FUNCTION_CALLING_VALUES = [True, False]

# ==================== RAG Configuration ====================

# Default RAG parameters (consistent with actual system)
DEFAULT_RAG_CONFIG = {
    "TOP_K": {
        "items": 5,
        "locations": 5,
        "abilities": 5,
        "npcs": 5,
        "organizations": 3,
        "taxonomies": 3,
        "rules": 10,
    },
    "SIMILARITY_THRESHOLD": 0.65,
}

# ==================== Cost Calculation ====================

# OpenAI pricing (per 1K tokens) - using gpt-4.1 pricing
PRICING = {
    "gpt-4-input": 0.002,      # $0.002 / 1K input tokens (gpt-4.1)
    "gpt-4-output": 0.008,     # $0.008 / 1K output tokens (gpt-4.1)
    "embedding": 0.0001,      # $0.0001 / 1K tokens
}

# ==================== Output Paths ====================

RESULTS_DIR = "results"
PLOTS_DIR = "results/plots"

# Result file names
BASELINE_RESULTS_FILE = f"{RESULTS_DIR}/baseline_comparison.csv"
ABLATION_THRESHOLD_FILE = f"{RESULTS_DIR}/ablation_rag_threshold.csv"
ABLATION_TOP_K_FILE = f"{RESULTS_DIR}/ablation_top_k.csv"
ABLATION_TEMPERATURE_FILE = f"{RESULTS_DIR}/ablation_temperature.csv"
ABLATION_FUNCTION_CALLING_FILE = f"{RESULTS_DIR}/ablation_function_calling.csv"
PERFORMANCE_METRICS_FILE = f"{RESULTS_DIR}/performance_metrics.csv"
STATISTICAL_ANALYSIS_FILE = f"{RESULTS_DIR}/statistical_analysis.txt"
