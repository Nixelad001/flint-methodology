#!/usr/bin/env python3
"""
IMCP Micro-Transformer
Ultra-small transformer architecture for IMCP pattern completion only.
Target: <10MB model size, <1M parameters
"""

import torch
import torch.nn as nn
import math

class IMCPMicroTransformer(nn.Module):
    """
    Tiny transformer optimized for IMCP pattern completion.
    
    Architecture:
    - Vocab: ~30 tokens (a-z, 0-2, =, _, {, }, ", :, space, comma, newline)
    - Embedding: 64 dim
    - 2 layers
    - 2 attention heads
    - No positional encoding (input is unordered)
    - FFN hidden: 128
    
    Total params: ~100k (< 1MB)
    """
    
    def __init__(
        self,
        vocab_size=50,  # Small vocab for IMCP tokens
        d_model=64,     # Embedding dimension
        n_heads=2,      # Attention heads
        n_layers=2,     # Transformer layers
        d_ff=128,       # FFN hidden size
        max_seq_len=64, # Max input length
        dropout=0.1
    ):
        super().__init__()
        
        self.d_model = d_model
        self.vocab_size = vocab_size
        
        # Token embedding
        self.embedding = nn.Embedding(vocab_size, d_model)
        
        # Positional encoding (learned, since order doesn't matter much in IMCP)
        self.pos_encoding = nn.Parameter(torch.randn(1, max_seq_len, d_model) * 0.02)
        
        # Transformer layers
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        
        # Output projection
        self.output_proj = nn.Linear(d_model, vocab_size)
        
        # Initialize weights
        self._init_weights()
    
    def _init_weights(self):
        """Initialize weights with small values."""
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.xavier_uniform_(p)
    
    def forward(self, x, padding_mask=None):
        """
        Forward pass.
        
        Args:
            x: (batch, seq_len) token indices
            padding_mask: (batch, seq_len) boolean mask (True = padding)
        
        Returns:
            logits: (batch, seq_len, vocab_size)
        """
        seq_len = x.size(1)
        
        # Embed tokens
        x = self.embedding(x)  # (batch, seq_len, d_model)
        
        # Add positional encoding
        x = x + self.pos_encoding[:, :seq_len, :]
        
        # Transform
        x = self.transformer(x, src_key_padding_mask=padding_mask)
        
        # Project to vocab
        logits = self.output_proj(x)
        
        return logits
    
    def count_parameters(self):
        """Count trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def create_tokenizer():
    """
    Create a simple character-level tokenizer for IMCP.
    
    Vocab: lowercase a-z, digits 0-9, special chars: = _ { } " : , space, newline
    Plus special tokens: <pad>, <sos>, <eos>
    """
    # Build vocab
    chars = list('abcdefghijklmnopqrstuvwxyz0123456789=_{}":, \n')
    special_tokens = ['<pad>', '<sos>', '<eos>']
    vocab = special_tokens + chars
    
    # Token to ID and ID to token
    token_to_id = {token: idx for idx, token in enumerate(vocab)}
    id_to_token = {idx: token for token, idx in token_to_id.items()}
    
    return token_to_id, id_to_token


class IMCPTokenizer:
    """Simple tokenizer for IMCP strings."""
    
    def __init__(self):
        self.token_to_id, self.id_to_token = create_tokenizer()
        self.vocab_size = len(self.token_to_id)
        self.pad_id = self.token_to_id['<pad>']
        self.sos_id = self.token_to_id['<sos>']
        self.eos_id = self.token_to_id['<eos>']
    
    def encode(self, text, add_special_tokens=True):
        """Encode text to token IDs."""
        tokens = []
        if add_special_tokens:
            tokens.append(self.sos_id)
        
        for char in text:
            if char in self.token_to_id:
                tokens.append(self.token_to_id[char])
            else:
                # Unknown char -> skip (or could add <unk>)
                pass
        
        if add_special_tokens:
            tokens.append(self.eos_id)
        
        return tokens
    
    def decode(self, token_ids, skip_special_tokens=True):
        """Decode token IDs to text."""
        chars = []
        for token_id in token_ids:
            if skip_special_tokens and token_id in [self.pad_id, self.sos_id, self.eos_id]:
                continue
            if token_id in self.id_to_token:
                chars.append(self.id_to_token[token_id])
        return ''.join(chars)
    
    def batch_encode(self, texts, max_length=64, padding=True):
        """Batch encode with padding."""
        encoded = [self.encode(text) for text in texts]
        
        if padding:
            max_len = min(max_length, max(len(seq) for seq in encoded))
            padded = []
            masks = []
            
            for seq in encoded:
                if len(seq) < max_len:
                    # Pad
                    mask = [False] * len(seq) + [True] * (max_len - len(seq))
                    seq = seq + [self.pad_id] * (max_len - len(seq))
                else:
                    # Truncate
                    seq = seq[:max_len]
                    mask = [False] * max_len
                
                padded.append(seq)
                masks.append(mask)
            
            return torch.tensor(padded), torch.tensor(masks)
        
        return encoded


if __name__ == '__main__':
    # Test model creation
    print("Creating IMCP Micro-Transformer...")
    model = IMCPMicroTransformer()
    
    params = model.count_parameters()
    print(f"✓ Model created: {params:,} parameters")
    print(f"✓ Estimated size: {params * 4 / 1024 / 1024:.2f} MB (fp32)")
    print(f"✓ Estimated size: {params * 2 / 1024 / 1024:.2f} MB (fp16)")
    
    # Test tokenizer
    print("\nTesting tokenizer...")
    tokenizer = IMCPTokenizer()
    print(f"✓ Vocab size: {tokenizer.vocab_size}")
    
    test_input = "m=_ p=_ c=_"
    test_output = '{"m": 0, "p": 1, "c": 2}'
    
    encoded_in = tokenizer.encode(test_input)
    encoded_out = tokenizer.encode(test_output)
    
    print(f"✓ Input:  '{test_input}' -> {len(encoded_in)} tokens")
    print(f"✓ Output: '{test_output}' -> {len(encoded_out)} tokens")
    
    decoded_in = tokenizer.decode(encoded_in)
    decoded_out = tokenizer.decode(encoded_out)
    
    print(f"✓ Decoded input:  '{decoded_in}'")
    print(f"✓ Decoded output: '{decoded_out}'")
    
    # Test forward pass
    print("\nTesting forward pass...")
    x = torch.randint(0, tokenizer.vocab_size, (2, 20))
    logits = model(x)
    print(f"✓ Input shape: {x.shape}")
    print(f"✓ Output shape: {logits.shape}")
    print(f"✓ Model ready for training")
