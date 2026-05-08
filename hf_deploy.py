from huggingface_hub import HfApi
import os
from dotenv import load_dotenv

# Load root .env
load_dotenv()

token = os.getenv("HUGGING_FACE_TOKEN")
gemini_key = os.getenv("GEMINI_API_KEY")
openrouter_key = os.getenv("OPENROUTER_API_KEY")
llm_provider = os.getenv("LLM_PROVIDER", "gemini")

if not token:
    print("❌ HUGGING_FACE_TOKEN not found in .env")
    exit(1)

api = HfApi()

try:
    user = api.whoami(token=token)["name"]
    repo_id = f"{user}/inferx-backend"
    
    print(f"🚀 Deploying to space {repo_id}...")
    try:
        api.create_repo(repo_id=repo_id, token=token, repo_type="space", space_sdk="docker", exist_ok=True)
    except Exception as e:
        print("Repo might exist or error:", e)

    print("📦 Uploading backend files to Hugging Face Spaces...")
    api.upload_folder(
        folder_path="app",
        path_in_repo="app",
        repo_id=repo_id,
        repo_type="space",
        token=token
    )
    api.upload_file(
        path_or_fileobj="Dockerfile",
        path_in_repo="Dockerfile",
        repo_id=repo_id,
        repo_type="space",
        token=token
    )
    api.upload_file(
        path_or_fileobj="requirements.txt",
        path_in_repo="requirements.txt",
        repo_id=repo_id,
        repo_type="space",
        token=token
    )
    
    print("📦 Uploading frontend files to Hugging Face Spaces (for Docker multi-stage build)...")
    api.upload_folder(
        folder_path="frontend",
        path_in_repo="frontend",
        repo_id=repo_id,
        repo_type="space",
        ignore_patterns=["node_modules/", "dist/", ".env.local"],
        token=token
    )
    
    print("🔒 Setting Secrets...")
    # Core APIs
    if gemini_key:
        api.add_space_secret(repo_id=repo_id, key="GEMINI_API_KEY", value=gemini_key, token=token)
    if openrouter_key:
        api.add_space_secret(repo_id=repo_id, key="OPENROUTER_API_KEY", value=openrouter_key, token=token)
    api.add_space_secret(repo_id=repo_id, key="LLM_PROVIDER", value=llm_provider, token=token)
    
    # MongoDB
    mongo_uri = os.getenv("MONGO_URI")
    if mongo_uri:
        api.add_space_secret(repo_id=repo_id, key="MONGO_URI", value=mongo_uri, token=token)
        
    # Firebase
    for fb_key in ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_APP_ID"]:
        fb_val = os.getenv(fb_key)
        if fb_val:
            api.add_space_secret(repo_id=repo_id, key=fb_key, value=fb_val, token=token)
    
    print(f"✅ Backend deployed at: https://huggingface.co/spaces/{repo_id}")
    with open('hf_space_url.txt', 'w') as f:
        f.write(f"https://{user}-inferx-backend.hf.space")
        
except Exception as e:
    print("❌ Error during HF deployment:", e)
