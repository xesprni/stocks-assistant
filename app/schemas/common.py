"""固定操作结果；业务函数返回模型，HTTP/JSON 边界负责序列化。"""

from app.constants.common import OperationStatus
from app.schemas.base import AppModel as BaseModel


class StatusResponse(BaseModel):
    status: OperationStatus = OperationStatus.OK


class MessageResponse(StatusResponse):
    message: str


class DeleteResponse(StatusResponse):
    deleted: int


class ToggleResponse(StatusResponse):
    enabled: bool


class RefreshResponse(StatusResponse):
    total: int
