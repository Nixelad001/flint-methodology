#!/usr/bin/env python3
"""
IMCP Micro-Transformer Training Script
Train the minimal model on IMCP pattern completion.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import json
from pathlib import Path
import time
from model import IMCPMicroTransformer, IMCPTokenizer

class IMCPDataset(Dataset):
    """Dataset for IMCP training pairs."""
    
    def __init__(self, jsonl_path, tokenizer, max_length=64):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.examples = []
        
        # Load data
        with open(jsonl_path) as f:
            for line in f:
                example = json.loads(line.strip())
                self.examples.append(example)
    
    def __len__(self):
        return len(self.examples)
    
    def __getitem__(self, idx):
        example = self.examples[idx]
        
        # Input: "m=_ p=_ c=_"
        input_text = example['input']
        # Target: '{"m": 0, "p": 1, "c": 2}'
        target_text = example['output']
        
        # Encode
        input_ids = self.tokenizer.encode(input_text, add_special_tokens=True)
        target_ids = self.tokenizer.encode(target_text, add_special_tokens=True)
        
        # Pad/truncate
        if len(input_ids) > self.max_length:
            input_ids = input_ids[:self.max_length]
        else:
            input_ids = input_ids + [self.tokenizer.pad_id] * (self.max_length - len(input_ids))
        
        if len(target_ids) > self.max_length:
            target_ids = target_ids[:self.max_length]
        else:
            target_ids = target_ids + [self.tokenizer.pad_id] * (self.max_length - len(target_ids))
        
        return {
            'input_ids': torch.tensor(input_ids, dtype=torch.long),
            'target_ids': torch.tensor(target_ids, dtype=torch.long)
        }


def train_epoch(model, dataloader, optimizer, criterion, device):
    """Train for one epoch."""
    model.train()
    total_loss = 0
    total_correct = 0
    total_tokens = 0
    
    for batch in dataloader:
        input_ids = batch['input_ids'].to(device)
        target_ids = batch['target_ids'].to(device)
        
        # Forward pass
        logits = model(input_ids)
        
        # Compute loss (cross-entropy)
        # Shift logits and targets for autoregressive prediction
        shift_logits = logits[:, :-1, :].contiguous()
        shift_targets = target_ids[:, 1:].contiguous()
        
        # Flatten for loss computation
        loss = criterion(
            shift_logits.view(-1, shift_logits.size(-1)),
            shift_targets.view(-1)
        )
        
        # Backward pass
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
        # Stats
        total_loss += loss.item()
        
        # Accuracy (ignoring padding)
        predictions = shift_logits.argmax(dim=-1)
        mask = shift_targets != 0  # Ignore padding (token 0 = <pad>)
        correct = (predictions == shift_targets) & mask
        total_correct += correct.sum().item()
        total_tokens += mask.sum().item()
    
    avg_loss = total_loss / len(dataloader)
    accuracy = total_correct / total_tokens if total_tokens > 0 else 0
    
    return avg_loss, accuracy


def validate(model, dataloader, criterion, device):
    """Validate the model."""
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
    
    avg_loss = total_loss / len(dataloader)
    accuracy = total_correct / total_tokens if total_tokens > 0 else 0
    
    return avg_loss, accuracy


def generate_sample(model, tokenizer, input_text, device, max_length=64):
    """Generate output for a given input."""
    model.eval()
    
    # Encode input
    input_ids = tokenizer.encode(input_text, add_special_tokens=True)
    input_tensor = torch.tensor([input_ids], dtype=torch.long).to(device)
    
    # Generate tokens autoregressively
    generated = input_ids.copy()
    
    with torch.no_grad():
        for _ in range(max_length - len(generated)):
            # Forward pass
            logits = model(input_tensor)
            
            # Get next token prediction
            next_token_logits = logits[0, -1, :]
            next_token = next_token_logits.argmax().item()
            
            # Stop at EOS
            if next_token == tokenizer.eos_id:
                break
            
            # Append token
            generated.append(next_token)
            input_tensor = torch.tensor([generated], dtype=torch.long).to(device)
    
    # Decode
    output_text = tokenizer.decode(generated, skip_special_tokens=True)
    return output_text


def main():
    # Config
    batch_size = 32
    learning_rate = 0.001
    num_epochs = 10
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    
    print(f"Device: {device}")
    print(f"Training IMCP Micro-Transformer...")
    print()
    
    # Create tokenizer
    tokenizer = IMCPTokenizer()
    print(f"Vocab size: {tokenizer.vocab_size}")
    
    # Load datasets
    train_dataset = IMCPDataset('train.jsonl', tokenizer)
    val_dataset = IMCPDataset('val.jsonl', tokenizer)
    
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size)
    
    print(f"Training examples: {len(train_dataset)}")
    print(f"Validation examples: {len(val_dataset)}")
    print()
    
    # Create model
    model = IMCPMicroTransformer(vocab_size=tokenizer.vocab_size).to(device)
    print(f"Model parameters: {model.count_parameters():,}")
    print()
    
    # Loss and optimizer
    criterion = nn.CrossEntropyLoss(ignore_index=tokenizer.pad_id)
    optimizer = optim.Adam(model.parameters(), lr=learning_rate)
    
    # Training loop
    best_val_loss = float('inf')
    
    for epoch in range(num_epochs):
        start_time = time.time()
        
        # Train
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion, device)
        
        # Validate
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        
        epoch_time = time.time() - start_time
        
        # Print stats
        print(f"Epoch {epoch+1}/{num_epochs} ({epoch_time:.1f}s)")
        print(f"  Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.2%}")
        print(f"  Val Loss:   {val_loss:.4f} | Val Acc:   {val_acc:.2%}")
        
        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_loss': val_loss,
                'val_acc': val_acc
            }, 'best_model.pt')
            print(f"  ✓ Saved best model")
        
        # Test generation every 2 epochs
        if (epoch + 1) % 2 == 0:
            test_inputs = [
                "m=_ p=_ c=_",
                "m=_ p=_ c=_ $=_",
                "c=_ d=_"
            ]
            print("\n  Sample generations:")
            for test_input in test_inputs:
                output = generate_sample(model, tokenizer, test_input, device)
                print(f"    Input:  {test_input}")
                print(f"    Output: {output}")
        
        print()
    
    print("Training complete!")
    print(f"Best validation loss: {best_val_loss:.4f}")
    
    # Save final model
    torch.save(model.state_dict(), 'final_model.pt')
    print("✓ Saved final model to final_model.pt")


if __name__ == '__main__':
    main()
