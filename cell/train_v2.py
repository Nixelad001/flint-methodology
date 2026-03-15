#!/usr/bin/env python3
"""
IMCP Symbol Training v2
Simplified: sequence-to-sequence for symbol prediction only.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import json
from model import IMCPMicroTransformer, IMCPTokenizer

class IMCPSymbolDataset(Dataset):
    """Dataset for IMCP symbol pairs."""
    
    def __init__(self, jsonl_path, tokenizer, max_length=32):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.examples = []
        
        with open(jsonl_path) as f:
            for line in f:
                example = json.loads(line.strip())
                self.examples.append(example)
    
    def __len__(self):
        return len(self.examples)
    
    def __getitem__(self, idx):
        example = self.examples[idx]
        
        input_text = example['input']
        target_text = example['output']
        
        # Encode
        input_ids = self.tokenizer.encode(input_text, add_special_tokens=True)
        target_ids = self.tokenizer.encode(target_text, add_special_tokens=True)
        
        # Pad
        input_ids = input_ids[:self.max_length] + [self.tokenizer.pad_id] * max(0, self.max_length - len(input_ids))
        target_ids = target_ids[:self.max_length] + [self.tokenizer.pad_id] * max(0, self.max_length - len(target_ids))
        
        return {
            'input_ids': torch.tensor(input_ids, dtype=torch.long),
            'target_ids': torch.tensor(target_ids, dtype=torch.long),
            'target_length': len(self.tokenizer.encode(target_text, add_special_tokens=True))
        }


def train_epoch(model, dataloader, optimizer, criterion, device):
    """Train one epoch."""
    model.train()
    total_loss = 0
    total_correct = 0
    total_tokens = 0
    
    for batch in dataloader:
        input_ids = batch['input_ids'].to(device)
        target_ids = batch['target_ids'].to(device)
        
        # Forward
        logits = model(input_ids)
        
        # Shift for next-token prediction
        shift_logits = logits[:, :-1, :].contiguous()
        shift_targets = target_ids[:, 1:].contiguous()
        
        # Loss
        loss = criterion(
            shift_logits.view(-1, shift_logits.size(-1)),
            shift_targets.view(-1)
        )
        
        # Backward
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
        # Stats
        total_loss += loss.item()
        predictions = shift_logits.argmax(dim=-1)
        mask = shift_targets != 0
        correct = (predictions == shift_targets) & mask
        total_correct += correct.sum().item()
        total_tokens += mask.sum().item()
    
    return total_loss / len(dataloader), total_correct / total_tokens if total_tokens > 0 else 0


def validate(model, dataloader, criterion, device):
    """Validate."""
    model.eval()
    total_loss = 0
    total_correct = 0
    total_tokens = 0
    
    with torch.no_grad():
        for batch in dataloader:
            input_ids = batch['input_ids'].to(device)
            target_ids = batch['target_ids'].to(device)
            
            logits = model(input_ids)
            shift_logits = logits[:, :-1, :].contiguous()
            shift_targets = target_ids[:, 1:].contiguous()
            
            loss = criterion(
                shift_logits.view(-1, shift_logits.size(-1)),
                shift_targets.view(-1)
            )
            
            total_loss += loss.item()
            predictions = shift_logits.argmax(dim=-1)
            mask = shift_targets != 0
            correct = (predictions == shift_targets) & mask
            total_correct += correct.sum().item()
            total_tokens += mask.sum().item()
    
    return total_loss / len(dataloader), total_correct / total_tokens if total_tokens > 0 else 0


def generate(model, tokenizer, input_text, device, max_new_tokens=20):
    """Generate symbols from input."""
    model.eval()
    
    input_ids = tokenizer.encode(input_text, add_special_tokens=True)
    input_tensor = torch.tensor([input_ids], dtype=torch.long).to(device)
    
    generated = input_ids.copy()
    
    with torch.no_grad():
        for _ in range(max_new_tokens):
            logits = model(input_tensor)
            next_token_logits = logits[0, -1, :]
            next_token = next_token_logits.argmax().item()
            
            if next_token == tokenizer.eos_id:
                break
            
            generated.append(next_token)
            input_tensor = torch.tensor([generated], dtype=torch.long).to(device)
    
    return tokenizer.decode(generated, skip_special_tokens=True)


def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Device: {device}\n")
    
    tokenizer = IMCPTokenizer()
    
    train_dataset = IMCPSymbolDataset('train_v2.jsonl', tokenizer)
    val_dataset = IMCPSymbolDataset('val_v2.jsonl', tokenizer)
    
    train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=64)
    
    print(f"Training: {len(train_dataset)} examples")
    print(f"Validation: {len(val_dataset)} examples\n")
    
    model = IMCPMicroTransformer(vocab_size=tokenizer.vocab_size).to(device)
    print(f"Model: {model.count_parameters():,} parameters\n")
    
    criterion = nn.CrossEntropyLoss(ignore_index=tokenizer.pad_id)
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    
    best_val_loss = float('inf')
    
    for epoch in range(15):
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        
        print(f"Epoch {epoch+1}/15")
        print(f"  Train: {train_loss:.4f} loss, {train_acc:.2%} acc")
        print(f"  Val:   {val_loss:.4f} loss, {val_acc:.2%} acc")
        
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), 'best_model_v2.pt')
            print(f"  ✓ Saved")
        
        # Test every 3 epochs
        if (epoch + 1) % 3 == 0:
            tests = ["m=_ p=_ c=_", "m=_ p=_ c=_ $=_", "c=_ d=_"]
            print("\n  Tests:")
            for test in tests:
                output = generate(model, tokenizer, test, device)
                print(f"    {test} -> {output}")
        
        print()
    
    print(f"✓ Best val loss: {best_val_loss:.4f}")
    torch.save(model.state_dict(), 'final_model_v2.pt')
    print("✓ Saved final_model_v2.pt")


if __name__ == '__main__':
    main()
