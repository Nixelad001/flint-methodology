#!/usr/bin/env python3
"""
IMCP Training Data Generator v2
Simplified: Input pattern -> Symbol output (no JSON)
"""

import json
import random
from itertools import product

COMPONENTS = ['m', 'p', 'c', '$', 'd', 'n']
STATUS_CODES = [0, 1, 2]
STATUS_SYMBOLS = {0: '✓', 1: '✗', 2: 'Δ'}

def generate_pattern_pair(components):
    """Generate input/symbol output pair."""
    # Random status for each component
    statuses = {comp: random.choice(STATUS_CODES) for comp in components}
    
    # Input: completion prompt
    input_pattern = ' '.join([f"{comp}=_" for comp in components])
    
    # Output: just symbols
    output_symbols = ''.join([STATUS_SYMBOLS[statuses[comp]] for comp in components])
    
    return {
        'input': input_pattern,
        'output': output_symbols
    }

def generate_all_combinations(components):
    """Generate all possible combinations."""
    pairs = []
    for statuses in product(STATUS_CODES, repeat=len(components)):
        input_pattern = ' '.join([f"{comp}=_" for comp in components])
        output_symbols = ''.join([STATUS_SYMBOLS[s] for s in statuses])
        pairs.append({'input': input_pattern, 'output': output_symbols})
    return pairs

def generate_dataset(total_examples=10000):
    """Generate training dataset."""
    dataset = []
    
    # Exhaustive coverage for common patterns
    common_patterns = [
        ['m', 'p', 'c'],
        ['m', 'p', 'c', '$'],
        ['m', 'p', 'c', '$', 'd'],
    ]
    
    for pattern in common_patterns:
        dataset.extend(generate_all_combinations(pattern))
    
    # Random variations
    for _ in range(total_examples - len(dataset)):
        num_components = random.randint(2, 6)
        components = random.sample(COMPONENTS, num_components)
        dataset.append(generate_pattern_pair(components))
    
    random.shuffle(dataset)
    return dataset

def save_dataset(dataset, filepath):
    """Save as JSONL."""
    with open(filepath, 'w') as f:
        for item in dataset:
            f.write(json.dumps(item) + '\n')

if __name__ == '__main__':
    print("Generating IMCP symbol training dataset (v2)...")
    
    train_data = generate_dataset(10000)
    split_idx = int(len(train_data) * 0.9)
    train_set = train_data[:split_idx]
    val_set = train_data[split_idx:]
    
    save_dataset(train_set, 'train_v2.jsonl')
    save_dataset(val_set, 'val_v2.jsonl')
    
    print(f"✓ Generated {len(train_set)} training examples")
    print(f"✓ Generated {len(val_set)} validation examples")
    
    print("\nSample examples:")
    for i, example in enumerate(train_set[:5]):
        print(f"{i+1}. Input:  {example['input']}")
        print(f"   Output: {example['output']}")
