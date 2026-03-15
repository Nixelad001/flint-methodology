#!/usr/bin/env python3
"""
IMCP Symbol Training v3
Fix: Separate encoder-decoder approach, only train on symbol output.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import json
from model import IMCPTokenizer

class SimpleIMCPModel(nn.Module):
    """
    Ultra-simple model: input embedding -> MLP -> symbol classification.
    No autoregressive generation, just direct mapping.
    """
    
    def __init__(self, vocab_size, max_components=6, hidden_dim=128):
        super().__init__()
        
        self.vocab_size = vocab_size
        self.max_components = max_components
        
        # Simple embedding + pooling + classification
        self.embedding = nn.Embedding(vocab_size, 64)
        self.encoder = nn.Sequential(
            nn.Linear(64, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU()
        )
        
        # Output: predict status for each component position (3 classes: ✓, ✗, Δ)
        self.classifier = nn.Linear(hidden_dim, max_components * 3)
    
    def forward(self, x):
        """
        x: (batch, seq_len) input token ids
        returns: (batch, max_components, 3) logits for each component
        """
        # Embed
        emb = self.embedding(x)  # (batch, seq_len, 64)
        
        # Pool over sequence
        pooled = emb.mean(dim=1)  # (batch, 64)
        
        # Encode
        hidden = self.encoder(pooled)  # (batch, hidden_dim)
        
        # Classify
        logits = self.classifier(hidden)  # (batch, max_components * 3)
        logits = logits.view(-1, self.max_components, 3)  # (batch, max_components, 3)
        
        return logits
    
    def count_parameters(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


class IMCPSymbolDatasetV3(Dataset):
    """Dataset that extracts component count and symbols."""
    
    def __init__(self, jsonl_path, tokenizer, max_components=6, max_length=32):
        self.tokenizer = tokenizer
        self.max_components = max_components
        self.max_length = max_length
        self.examples = []
        
        symbol_to_id = {'✓': 0, '✗': 1, 'Δ': 2}
        
        with open(jsonl_path) as f:
            for line in f:
                example = json.loads(line.strip())
                
                # Parse input to count components
                input_text = example['input']
                num_components = input_text.count('=_')
                
                # Parse output symbols
                output_symbols = example['output']
                symbol_ids = [symbol_to_id.get(s, 0) for s in output_symbols]
                
                # Pad to max_components
                symbol_ids = symbol_ids[:max_components]
                symbol_ids += [0] * (max_components - len(symbol_ids))
                
                # Encode input
                input_ids = self.tokenizer.encode(input_text, add_special_tokens=True)
                input_ids = input_ids[:max_length] + [self.tokenizer.pad_id] * max(0, max_length - len(input_ids))
                
                self.examples.append({
                    'input_ids': torch.tensor(input_ids, dtype=torch.long),
                    'symbol_ids': torch.tensor(symbol_ids, dtype=torch.long),
                    'num_components': num_components
                })
    
    def __len__(self):
        return len(self.examples)
    
    def __getitem__(self, idx):
        return self.examples[idx]


def train_epoch(model, dataloader, optimizer, criterion, device):
    """Train one epoch."""
    model.train()
    total_loss = 0
    total_correct = 0
    total_symbols = 0
    
    for batch in dataloader:
        input_ids = batch['input_ids'].to(device)
        symbol_ids = batch['symbol_ids'].to(device)
        num_components = batch['num_components']
        
        # Forward
        logits = model(input_ids)  # (batch, max_components, 3)
        
        # Flatten for loss
        logits_flat = logits.view(-1, 3)
        targets_flat = symbol_ids.view(-1)
        
        # Loss
        loss = criterion(logits_flat, targets_flat)
        
        # Backward
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
        # Stats
        total_loss += loss.item()
        predictions = logits.argmax(dim=-1)  # (batch, max_components)
        
        # Only count accuracy for actual components (not padding)
        for i, n in enumerate(num_components):
            correct = (predictions[i, :n] == symbol_ids[i, :n]).sum().item()
            total_correct += correct
            total_symbols += n
    
    return total_loss / len(dataloader), total_correct / total_symbols if total_symbols > 0 else 0


def validate(model, dataloader, criterion, device):
    """Validate."""
    model.eval()
    total_loss = 0
    total_correct = 0
    total_symbols = 0
    
    with torch.no_grad():
        for batch in dataloader:
            input_ids = batch['input_ids'].to(device)
            symbol_ids = batch['symbol_ids'].to(device)
            num_components = batch['num_components']
            
            logits = model(input_ids)
            
            logits_flat = logits.view(-1, 3)
            targets_flat = symbol_ids.view(-1)
            loss = criterion(logits_flat, targets_flat)
            
            total_loss += loss.item()
            predictions = logits.argmax(dim=-1)
            
            for i, n in enumerate(num_components):
                correct = (predictions[i, :n] == symbol_ids[i, :n]).sum().item()
                total_correct += correct
                total_symbols += n
    
    return total_loss / len(dataloader), total_correct / total_symbols if total_symbols > 0 else 0


def predict(model, tokenizer, input_text, device):
    """Predict symbols for input."""
    model.eval()
    
    # Count components
    num_components = input_text.count('=_')
    
    # Encode
    input_ids = tokenizer.encode(input_text, add_special_tokens=True)
    input_ids = input_ids[:32] + [tokenizer.pad_id] * max(0, 32 - len(input_ids))
    input_tensor = torch.tensor([input_ids], dtype=torch.long).to(device)
    
    # Predict
    with torch.no_grad():
        logits = model(input_tensor)  # (1, max_components, 3)
        predictions = logits.argmax(dim=-1)[0]  # (max_components,)
    
    # Convert to symbols
    id_to_symbol = {0: '✓', 1: '✗', 2: 'Δ'}
    symbols = ''.join([id_to_symbol[predictions[i].item()] for i in range(num_components)])
    
    return symbols


def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Device: {device}\n")
    
    tokenizer = IMCPTokenizer()
    
    train_dataset = IMCPSymbolDatasetV3('train_v2.jsonl', tokenizer)
    val_dataset = IMCPSymbolDatasetV3('val_v2.jsonl', tokenizer)
    
    train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=64)
    
    print(f"Training: {len(train_dataset)} examples")
    print(f"Validation: {len(val_dataset)} examples\n")
    
    model = SimpleIMCPModel(vocab_size=tokenizer.vocab_size).to(device)
    print(f"Model: {model.count_parameters():,} parameters\n")
    
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    
    best_val_acc = 0
    
    for epoch in range(20):
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        
        print(f"Epoch {epoch+1}/20")
        print(f"  Train: {train_loss:.4f} loss, {train_acc:.2%} acc")
        print(f"  Val:   {val_loss:.4f} loss, {val_acc:.2%} acc")
        
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), 'best_model_v3.pt')
            print(f"  ✓ Saved")
        
        # Test every 4 epochs
        if (epoch + 1) % 4 == 0:
            tests = ["m=_ p=_ c=_", "m=_ p=_ c=_ $=_", "c=_ d=_", "m=_ p=_"]
            print("\n  Tests:")
            for test in tests:
                output = predict(model, tokenizer, test, device)
                print(f"    {test} -> {output}")
        
        print()
    
    print(f"✓ Best val acc: {best_val_acc:.2%}")
    torch.save(model.state_dict(), 'final_model_v3.pt')
    print("✓ Saved final_model_v3.pt")


if __name__ == '__main__':
    main()
