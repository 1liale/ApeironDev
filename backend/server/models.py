from database import Base
from sqlalchemy import Column, Integer, String

class ExecResult(Base):
    __tablename__ = 'exec_results'
    
    id = Column(Integer, primary_key=True, index=True)
    src = Column(String, nullable=False)
    stdin = Column(String, nullable=True)
    res = Column(String, nullable=True)