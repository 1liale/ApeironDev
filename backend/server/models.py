from pydantic import BaseModel
from database import Base
from sqlalchemy import Column, Integer, String

class ExecResult(Base):
    __tablename__ = 'exec_results'
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False)
    stdin = Column(String, nullable=True)
    output = Column(String, nullable=True)