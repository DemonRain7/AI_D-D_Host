"""
Regenerate Threshold ablation experiment plots
Change the first plot from "Retrieved Entities vs Threshold" to "Latency vs Threshold"
"""

import json
import numpy as np
import matplotlib.pyplot as plt

# Read threshold experiment results
import os
base_dir = os.path.dirname(os.path.abspath(__file__))
results_path = os.path.join(base_dir, 'results', 'threshold_results_backup.json')
with open(results_path, 'r', encoding='utf-8') as f:
    threshold_results = json.load(f)

# Convert string keys to floats
threshold_results = {float(k): v for k, v in threshold_results.items()}

threshold_values = [0.5, 0.65, 0.8]

# Calculate statistics for each threshold
latencies = []
input_tokens_list = []
costs = []

for threshold in threshold_values:
    results = threshold_results[threshold]

    # Latency
    latency_vals = [r['latency'] for r in results]
    latencies.append(np.mean(latency_vals))

    # Input Tokens
    input_token_vals = [r['input_tokens'] for r in results]
    input_tokens_list.append(np.mean(input_token_vals))

    # Cost (estimate: input_tokens * 0.03/1000 + output_tokens * 0.06/1000)
    cost_vals = []
    for r in results:
        input_cost = r['input_tokens'] * 0.03 / 1000
        output_cost = r['output_tokens'] * 0.06 / 1000
        cost_vals.append(input_cost + output_cost)
    costs.append(np.mean(cost_vals))

# Create plots
fig, axes = plt.subplots(1, 3, figsize=(18, 5))

# 1. Latency vs Threshold (replacing the original Retrieved Entities)
axes[0].plot(threshold_values, latencies, marker='o', linewidth=2, markersize=8, color='blue')
axes[0].set_xlabel('Similarity Threshold')
axes[0].set_ylabel('Avg Latency (s)')
axes[0].set_title('Latency vs Threshold')
axes[0].grid(alpha=0.3)

# 2. Input Tokens vs Threshold
axes[1].plot(threshold_values, input_tokens_list, marker='s', linewidth=2, markersize=8, color='orange')
axes[1].set_xlabel('Similarity Threshold')
axes[1].set_ylabel('Avg Input Tokens')
axes[1].set_title('Input Tokens vs Threshold')
axes[1].grid(alpha=0.3)

# 3. Cost vs Threshold
axes[2].plot(threshold_values, costs, marker='^', linewidth=2, markersize=8, color='green')
axes[2].set_xlabel('Similarity Threshold')
axes[2].set_ylabel('Avg Cost ($)')
axes[2].set_title('Cost vs Threshold')
axes[2].grid(alpha=0.3)

plt.tight_layout()
output_path = os.path.join(base_dir, 'results', 'plots', 'ablation_threshold.png')
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"[OK] Figure saved to {output_path}")

# Print data verification
print("\nData Verification:")
for i, threshold in enumerate(threshold_values):
    print(f"Threshold = {threshold}:")
    print(f"  Latency: {latencies[i]:.2f}s")
    print(f"  Input Tokens: {input_tokens_list[i]:.0f}")
    print(f"  Cost: ${costs[i]:.4f}")
