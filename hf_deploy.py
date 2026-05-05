from huggingface_hub import HfApi
import os

token = "YOUR_HF_TOKEN"
api = HfApi()

try:
    user = api.whoami(token=token)["name"]
    repo_id = f"{user}/inferx-backend"
    
    print(f"Creating space {repo_id}...")
    try:
        api.create_repo(repo_id=repo_id, token=token, repo_type="space", space_sdk="docker")
    except Exception as e:
        print("Repo might exist or error:", e)

    print("Uploading backend files to Hugging Face Spaces...")
    # Upload backend
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
    api.upload_file(
        path_or_fileobj="app/api.py",
        path_in_repo="app/api.py",
        repo_id=repo_id,
        repo_type="space",
        token=token
    )
    api.upload_file(
        path_or_fileobj="app/llm/client.py",
        path_in_repo="app/llm/client.py",
        repo_id=repo_id,
        repo_type="space",
        token=token
    )
    print("Setting Secrets...")
    api.add_space_secret(repo_id=repo_id, key="OPENROUTER_API_KEY", value="YOUR_OPENROUTER_KEY", token=token)
    api.add_space_secret(repo_id=repo_id, key="GEMINI_API_KEY", value="YOUR_GEMINI_KEY", token=token)
    
    # Enable space
    print(f"✅ Backend deployed at: https://huggingface.co/spaces/{repo_id}")
    with open('hf_space_url.txt', 'w') as f:
        f.write(f"https://{user}-inferx-backend.hf.space")
        
except Exception as e:
    print("Error:", e)
