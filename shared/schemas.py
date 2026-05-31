from typing import Any, Generic, TypeVar
from pydantic import BaseModel

T = TypeVar('T')


class ApiResponse(BaseModel, Generic[T]):
    data: Any | None = None
    error: str | None = None
    status: int = 200
