from pydantic import BaseModel
from typing import Optional

class TestA(BaseModel):
    name: str = "default"

try:
    print(TestA.model_validate({"name": None}))
except Exception as e:
    print(e)
