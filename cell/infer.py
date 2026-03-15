#!/usr/bin/env python3
"""
IMCP Cell Inference
Fast inference using the trained micro-transformer for tier 0-1 IMCP pattern completion.
"""
import sys
import torch
from model import IMCPMicroTransformer, IMCPTokenizer

# Load model
MODEL_PATH = '/home/dale/clawd/imcp-cell/best_model_v4.pt'
device = torch.device('cpu')  # Fast enough on CPU for 100k params

# Initialize
model = IMCPMicroTransformer()
model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
model.eval()

tokenizer = IMCPTokenizer()

def predict(input_text):
    """Run inference on IMCP pattern."""
    with torch.no_grad():
        # Encode
        tokens = tokenizer.encode(input_text, add_special_tokens=True)
        x = torch.tensor([tokens], device=device)
        
        # Forward pass
        logits = model(x)
        
        # Decode (greedy, just take argmax)
        predicted_ids = logits.argmax(dim=-1).squeeze().tolist()
        
        # Convert to string
        output = tokenizer.decode(predicted_ids, skip_special_tokens=True)
        
        return output.strip()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('{"error": "no input provided"}')
        sys.exit(1)
    
    input_pattern = sys.argv[1]
    result = predict(input_pattern)
    print(result)
