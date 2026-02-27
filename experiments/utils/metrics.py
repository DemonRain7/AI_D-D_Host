"""
Metrics calculation and statistical analysis tools
"""

import numpy as np
from scipy import stats
from typing import List, Dict, Tuple


# OpenAI pricing (per 1K tokens)
PRICING = {
    "gpt-4-input": 0.03,      # $0.03 / 1K input tokens
    "gpt-4-output": 0.06,     # $0.06 / 1K output tokens
    "embedding": 0.0001,      # $0.0001 / 1K tokens
}


def calculate_cost(input_tokens: int, output_tokens: int, embedding_tokens: int = 0) -> float:
    """Calculate cost for a single request"""
    input_cost = (input_tokens / 1000) * PRICING['gpt-4-input']
    output_cost = (output_tokens / 1000) * PRICING['gpt-4-output']
    embedding_cost = (embedding_tokens / 1000) * PRICING['embedding']
    return input_cost + output_cost + embedding_cost


def calculate_context_efficiency(rag_tokens: int, full_tokens: int) -> float:
    """Calculate context efficiency (reduction percentage)"""
    if full_tokens == 0:
        return 0.0
    reduction = (full_tokens - rag_tokens) / full_tokens
    return reduction * 100


def aggregate_metrics(results: List[Dict]) -> Dict:
    """Aggregate metrics from multiple experiment runs"""
    if not results:
        return {}

    input_tokens = [r['input_tokens'] for r in results]
    output_tokens = [r['output_tokens'] for r in results]
    total_tokens = [r['total_tokens'] for r in results]
    latencies = [r['latency'] for r in results]
    context_sizes = [r.get('context_size_tokens', 0) for r in results]

    costs = [
        calculate_cost(r['input_tokens'], r['output_tokens'])
        for r in results
    ]

    return {
        'count': len(results),
        'input_tokens': {
            'mean': np.mean(input_tokens),
            'std': np.std(input_tokens),
            'min': np.min(input_tokens),
            'max': np.max(input_tokens),
        },
        'output_tokens': {
            'mean': np.mean(output_tokens),
            'std': np.std(output_tokens),
            'min': np.min(output_tokens),
            'max': np.max(output_tokens),
        },
        'total_tokens': {
            'mean': np.mean(total_tokens),
            'std': np.std(total_tokens),
            'min': np.min(total_tokens),
            'max': np.max(total_tokens),
        },
        'latency': {
            'mean': np.mean(latencies),
            'std': np.std(latencies),
            'min': np.min(latencies),
            'max': np.max(latencies),
        },
        'context_size': {
            'mean': np.mean(context_sizes),
            'std': np.std(context_sizes),
            'min': np.min(context_sizes),
            'max': np.max(context_sizes),
        },
        'cost': {
            'mean': np.mean(costs),
            'std': np.std(costs),
            'min': np.min(costs),
            'max': np.max(costs),
            'total': np.sum(costs),
        }
    }


def perform_t_test(
    group1_results: List[Dict],
    group2_results: List[Dict],
    metric_key: str
) -> Tuple[float, float]:
    """Perform t-test on two groups of results

    Args:
        group1_results: First group of experiment results
        group2_results: Second group of experiment results
        metric_key: Metric key to compare (e.g., 'total_tokens', 'latency')

    Returns:
        (t_statistic, p_value)
    """
    group1_values = [r[metric_key] for r in group1_results]
    group2_values = [r[metric_key] for r in group2_results]

    t_stat, p_value = stats.ttest_ind(group1_values, group2_values)
    return t_stat, p_value


def calculate_confidence_interval(values: List[float], confidence: float = 0.95) -> Tuple[float, float]:
    """Calculate confidence interval

    Args:
        values: List of numeric values
        confidence: Confidence level (default 95%)

    Returns:
        (lower_bound, upper_bound)
    """
    mean = np.mean(values)
    std_err = stats.sem(values)
    margin = std_err * stats.t.ppf((1 + confidence) / 2, len(values) - 1)

    return (mean - margin, mean + margin)


def compare_baselines(
    no_rag_results: List[Dict],
    random_results: List[Dict],
    rag_results: List[Dict]
) -> Dict:
    """Compare three baseline configurations"""

    comparison = {
        'no_rag': aggregate_metrics(no_rag_results),
        'random': aggregate_metrics(random_results),
        'rag': aggregate_metrics(rag_results),
    }

    # Calculate significance
    comparison['significance_tests'] = {}

    # RAG vs No RAG
    for metric in ['total_tokens', 'latency']:
        t_stat, p_value = perform_t_test(rag_results, no_rag_results, metric)
        comparison['significance_tests'][f'rag_vs_no_rag_{metric}'] = {
            't_statistic': t_stat,
            'p_value': p_value,
            'significant': p_value < 0.05
        }

    # RAG vs Random
    for metric in ['total_tokens', 'latency']:
        t_stat, p_value = perform_t_test(rag_results, random_results, metric)
        comparison['significance_tests'][f'rag_vs_random_{metric}'] = {
            't_statistic': t_stat,
            'p_value': p_value,
            'significant': p_value < 0.05
        }

    # Calculate context efficiency
    if no_rag_results and rag_results:
        avg_no_rag_tokens = np.mean([r['input_tokens'] for r in no_rag_results])
        avg_rag_tokens = np.mean([r['input_tokens'] for r in rag_results])
        comparison['context_efficiency_percentage'] = calculate_context_efficiency(
            avg_rag_tokens,
            avg_no_rag_tokens
        )

    return comparison


def format_metrics_table(metrics: Dict) -> str:
    """Format metrics as Markdown table"""
    lines = []
    lines.append("| Metric | Mean | Std | Min | Max |")
    lines.append("|--------|------|-----|-----|-----|")

    for metric_name, metric_values in metrics.items():
        if isinstance(metric_values, dict) and 'mean' in metric_values:
            lines.append(
                f"| {metric_name} | {metric_values['mean']:.2f} | "
                f"{metric_values['std']:.2f} | {metric_values['min']:.2f} | "
                f"{metric_values['max']:.2f} |"
            )

    return "\n".join(lines)


def calculate_cost_savings(no_rag_cost: float, rag_cost: float) -> Dict:
    """Calculate cost savings"""
    savings_amount = no_rag_cost - rag_cost
    savings_percentage = (savings_amount / no_rag_cost) * 100 if no_rag_cost > 0 else 0

    return {
        'savings_amount': savings_amount,
        'savings_percentage': savings_percentage,
        'no_rag_cost': no_rag_cost,
        'rag_cost': rag_cost
    }
