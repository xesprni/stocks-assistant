"""应用数据模型的共同配置。"""

from pydantic import BaseModel, ConfigDict


class AppModel(BaseModel):
    # 不同边界可以投影同一业务模型，避免在服务间反复转成匿名字典。
    model_config = ConfigDict(from_attributes=True)
