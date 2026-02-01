"""
JoyCaption inference script for LoRA Dataset Studio.
Uses John6666/llama-joycaption-beta-one-hf-llava-nf4 (4-bit).
Usage:
  Single: python joycaption_inference.py --image <path> [--mode ...] [--low-vram]
  Batch:  python joycaption_inference.py --image <path1> --image <path2> ... [--mode ...] [--low-vram]
Output: One caption per line (same order as --image). Newlines in captions are replaced by space.
"""
import argparse
import sys

# Mode to prompt (JoyCaption Beta One prompts from fpgaminer/joycaption README)
MODE_PROMPTS = {
    "descriptive": "Write a long detailed description for this image.",
    "straightforward": (
        "Write a straightforward caption for this image. Begin with the main subject and medium. "
        "Mention pivotal elements—people, objects, scenery—using confident, definite language. "
        "Focus on concrete details like color, shape, texture, and spatial relationships. "
        "Show how elements interact. Omit mood and speculative wording. "
        "If text is present, quote it exactly. Note any watermarks, signatures, or compression artifacts. "
        "Never mention what's absent, resolution, or unobservable details. "
        "Vary your sentence structure and keep the description concise, without starting with \"This image is…\" or similar phrasing."
    ),
    "booru": (
        "Generate only comma-separated Danbooru tags (lowercase_underscores). "
        "Strict order: artist:, copyright:, character:, meta:, then general tags. "
        "Include counts (1girl), appearance, clothing, accessories, pose, expression, actions, background. "
        "Use precise Danbooru syntax. No extra text."
    ),
    "training": (
        "Create a training caption for this image. Start with the main subject, then describe pose, "
        "expression, clothing, background, and art style. Use comma-separated tags. Be specific about visual details."
    ),
}

DEFAULT_PROMPT = MODE_PROMPTS["descriptive"]

# Delimiter for batch output: each line = one caption (newlines in caption replaced by this)
OUTPUT_LINE_SEP = "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", action="append", required=True, help="Path to image (repeat for batch)")
    parser.add_argument("--mode", default="descriptive", choices=list(MODE_PROMPTS.keys()))
    parser.add_argument("--low-vram", action="store_true")
    args = parser.parse_args()

    image_paths = args.image
    prompt = MODE_PROMPTS.get(args.mode, DEFAULT_PROMPT)

    try:
        import torch
        from PIL import Image
        from transformers import AutoProcessor, LlavaForConditionalGeneration, BitsAndBytesConfig
    except ImportError as e:
        print(f"Error: Missing dependency: {e}", file=sys.stderr)
        sys.exit(1)

    model_id = "John6666/llama-joycaption-beta-one-hf-llava-nf4"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("Warning: No GPU. Running on CPU (slow).", file=sys.stderr)

    # Load processor and model once
    try:
        processor = AutoProcessor.from_pretrained(model_id)
    except Exception as e:
        print(f"Error loading processor: {e}", file=sys.stderr)
        sys.exit(1)

    bnb_config = None
    if device == "cuda" and (args.low_vram or "nf4" in model_id):
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_quant_type="nf4",
        )

    try:
        if bnb_config is not None:
            model = LlavaForConditionalGeneration.from_pretrained(
                model_id, quantization_config=bnb_config, device_map="auto"
            )
        else:
            model = LlavaForConditionalGeneration.from_pretrained(
                model_id, torch_dtype=torch.bfloat16, device_map="auto"
            )
        model.eval()
    except Exception as e:
        print(f"Error loading model: {e}", file=sys.stderr)
        sys.exit(1)

    convo = [
        {"role": "system", "content": "You are a helpful image captioner."},
        {"role": "user", "content": prompt},
    ]
    convo_string = processor.apply_chat_template(convo, tokenize=False, add_generation_prompt=True)
    assert isinstance(convo_string, str)

    lines = []
    for idx, image_path in enumerate(image_paths):
        try:
            image = Image.open(image_path).convert("RGB")
        except Exception as e:
            print(f"Error opening image {image_path!r}: {e}", file=sys.stderr)
            lines.append("")
            continue

        inputs = processor(text=[convo_string], images=[image], return_tensors="pt")
        inputs = {k: v.to(model.device) if hasattr(v, "to") else v for k, v in inputs.items()}
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(torch.float16)

        with torch.no_grad():
            generate_ids = model.generate(
                **inputs,
                max_new_tokens=512,
                do_sample=True,
                temperature=0.6,
                top_p=0.9,
            )[0]

        generate_ids = generate_ids[inputs["input_ids"].shape[1]:]
        caption = processor.tokenizer.decode(
            generate_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        caption = caption.strip().replace("\n", " ")
        lines.append(caption)

    # One caption per line (order matches image_paths)
    print(OUTPUT_LINE_SEP.join(lines))


if __name__ == "__main__":
    main()
