from typing import Annotated

from pydantic import BaseModel, Field


class DeviceInfo(BaseModel):
    ip_address: Annotated[str, Field(description="The IP address of the device")]
    user_agent: Annotated[str, Field(description="The user agent string of the device")]
