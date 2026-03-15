#!/usr/bin/env python3
"""
IMCP Training Data Generator v4
Deterministic rules: each component maps to a consistent symbol.
"""

import json
import random
from itertools import product

COMPONENTS = ['m', 'p', 'c', '$', 'd', 'n']

# Deterministic mapping: each component always maps to the same symbol
COMPONENT_RULES = {
    'm': '✓',  # memory always OK
    'p': '✗',  # processes always error
    'c': 'Δ',  # context always changed
    '$': '✓',  # credits always OK
    'd': '✗',  # disk always error
    'n': 'Δ',  # network always changed
}

def generate_deterministic_pair(components):
    """Generate input/output pair with deterministic rules."""
    # Input: completion prompt
    input_pattern = ' '.join([f"{comp}=_" for comp in components])
    
    # Output: apply rules
    output_symbols = ''.join([COMPONENT_RULES[comp] for comp in components])
    
    return {
        'input': input_pattern,
        'output': output_symbols
    }

def generate_all_combinations():
    """Generate all possible component orderings."""
    pairs = []
    
    # All 1-6 component combinations
    for length in range(1, 7):
        from itertools import permutations
        for perm in permutations(COMPONENTS, length):
            pairs.append(generate_deterministic_pair(list(perm)))
    
    return pairs

def generate_dataset(total_examples=10000):
    """Generate training dataset with deterministic rules."""
    dataset = []
    
    # 1. All possible orderings (exhaustive)
    all_perms = generate_all_combinations()
    dataset.extend(all_perms)
    
    print(f"Generated {len(all_perms)} exhaustive combinations")
    
    # 2. Augment with duplicates to reach target size
    while len(dataset) < total_examples:
        # Random component subset
        num_components = random.randint(2, 6)
        components = random.sample(COMPONENTS, num_components)
        dataset.append(generate_deterministic_pair(components))
    
    # 3. Shuffle
    random.shuffle(dataset)
    
    return dataset

def save_dataset(dataset, filepath):
    """Save as JSONL."""
    with open(filepath, 'w') as f:
        for item in dataset:
            f.write(json.dumps(item) + '\n')

if __name__ == '__main__':
    print("Generating IMCP deterministic training dataset (v4)...")
    print("\nRules:")
    for comp, symbol in COMPONENT_RULES.items():
        print(f"  {comp}=_ → {symbol}")
    print()
    
    train_data = generate_dataset(10000)
    split_idx = int(len(train_data) * 0.9)
    train_set = train_data[:split_idx]
    val_set = train_data[split_idx:]
    
    save_dataset(train_set, 'train_v4.jsonl')
    save_dataset(val_set, 'val_v4.jsonl')
    
    print(f"✓ Generated {len(train_set)} training examples")
    print(f"✓ Generated {len(val_set)} validation examples")
    
    print("\nSample examples:")
    for i, example in enumerate(train_set[:10]):
        print(f"{i+1}. Input:  {example['input']:25s} Output: {example['output']}")
    
    # Verify determinism
    print("\nVerifying deterministic mapping...")
    test_input = "m=_ p=_ c=_"
    expected = "✓✗Δ"
    matches = [ex for ex in train_set if ex['input'] == test_input]
    
    if matches:
        all_same = all(ex['output'] == expected for ex in matches)
        print(f"  Input '{test_input}' appears {len(matches)} times")
        print(f"  All outputs are '{expected}': {all_same}")
        if all_same:
            print("  ✓ Determinism verified")
        else:
            print("  ✗ ERROR: Inconsistent outputs!")
    else:
        print(f"  (Input '{test_input}' not in dataset)")
