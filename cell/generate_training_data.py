#!/usr/bin/env python3
"""
IMCP Training Data Generator
Generates synthetic IMCP pattern completion pairs for training a micro-model.
"""

import json
import random
from itertools import product

# Component codes from PROTOCOL.md
COMPONENTS = ['m', 'p', 'c', '$', 'd', 'n']
COMPONENT_NAMES = {
    'm': 'memory',
    'p': 'processes', 
    'c': 'context',
    '$': 'credits',
    'd': 'disk',
    'n': 'network'
}

# Status codes
STATUS_CODES = [0, 1, 2]  # 0=ok, 1=error, 2=changed
STATUS_SYMBOLS = {0: '✓', 1: '✗', 2: 'Δ'}

def generate_pattern_pair(components, include_symbols=False):
    """Generate a single IMCP input/output pair."""
    # Random status for each component
    statuses = {comp: random.choice(STATUS_CODES) for comp in components}
    
    # Input: completion prompt
    input_pattern = ' '.join([f"{comp}=_" for comp in components])
    
    # Output: JSON
    output_json = {comp: statuses[comp] for comp in components}
    
    # Optional: include symbol translation
    if include_symbols:
        symbol_line = ''.join([STATUS_SYMBOLS[statuses[comp]] for comp in components])
        return {
            'input': input_pattern,
            'output': json.dumps(output_json),
            'symbols': symbol_line
        }
    
    return {
        'input': input_pattern,
        'output': json.dumps(output_json)
    }

def generate_all_combinations(components):
    """Generate all possible combinations for given components."""
    pairs = []
    # All possible status combinations
    for statuses in product(STATUS_CODES, repeat=len(components)):
        status_dict = dict(zip(components, statuses))
        input_pattern = ' '.join([f"{comp}=_" for comp in components])
        output_json = json.dumps(status_dict)
        pairs.append({'input': input_pattern, 'output': output_json})
    return pairs

def generate_dataset(total_examples=10000):
    """Generate a full training dataset."""
    dataset = []
    
    # 1. All exact combinations for common patterns (exhaustive coverage)
    common_patterns = [
        ['m', 'p', 'c'],           # Basic trio
        ['m', 'p', 'c', '$'],      # With credits
        ['m', 'p', 'c', '$', 'd'], # Full status
    ]
    
    for pattern in common_patterns:
        dataset.extend(generate_all_combinations(pattern))
    
    # 2. Random variations with different component orders
    for _ in range(total_examples - len(dataset)):
        num_components = random.randint(2, 6)
        components = random.sample(COMPONENTS, num_components)
        dataset.append(generate_pattern_pair(components))
    
    # 3. Shuffle
    random.shuffle(dataset)
    
    return dataset

def save_dataset(dataset, filepath, format='jsonl'):
    """Save dataset to file."""
    if format == 'jsonl':
        with open(filepath, 'w') as f:
            for item in dataset:
                f.write(json.dumps(item) + '\n')
    elif format == 'json':
        with open(filepath, 'w') as f:
            json.dump(dataset, f, indent=2)

if __name__ == '__main__':
    print("Generating IMCP training dataset...")
    
    # Generate 10k examples
    train_data = generate_dataset(10000)
    
    # Split train/validation (90/10)
    split_idx = int(len(train_data) * 0.9)
    train_set = train_data[:split_idx]
    val_set = train_data[split_idx:]
    
    # Save
    save_dataset(train_set, 'train.jsonl', format='jsonl')
    save_dataset(val_set, 'val.jsonl', format='jsonl')
    
    print(f"✓ Generated {len(train_set)} training examples")
    print(f"✓ Generated {len(val_set)} validation examples")
    print(f"✓ Saved to train.jsonl and val.jsonl")
    
    # Show sample
    print("\nSample examples:")
    for i, example in enumerate(train_set[:5]):
        print(f"{i+1}. Input:  {example['input']}")
        print(f"   Output: {example['output']}")
