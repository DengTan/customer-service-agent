#!/usr/bin/env python
"""
FlashRank Rerank Service
启动命令: python flashrank-server.py
默认端口: 8000

API 格式:
POST /rerank
{
  "query": "用户问题",
  "documents": ["文档1", "文档2", ...]
}

返回格式:
{
  "results": [
    {"index": 0, "text": "文档1", "score": 0.95},
    {"index": 1, "text": "文档2", "score": 0.85},
    ...
  ]
}
"""
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="FlashRank Rerank Service")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 请求/响应模型
class RerankRequest(BaseModel):
    query: str
    documents: List[str]
    top_k: int = None

class RerankResult(BaseModel):
    index: int
    text: str
    score: float

class RerankResponse(BaseModel):
    results: List[RerankResult]

# 全局 Reranker 实例 (首次请求时加载)
_ranker = None

def get_ranker():
    """懒加载 Reranker"""
    global _ranker
    if _ranker is None:
        logger.info("Loading FlashRank model...")
        from flashrank import Ranker
        # ranker.pkl.gz 会在首次运行时自动下载
        _ranker = Ranker()
        logger.info("FlashRank model loaded!")
    return _ranker

@app.get("/")
async def root():
    return {"status": "ok", "service": "FlashRank Rerank Service", "port": 8000}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest):
    """Rerank documents based on query"""
    try:
        ranker = get_ranker()
        
        # 转换为 FlashRank 格式
        from flashrank import RerankRequest as FlashRankRequest
        flashrank_request = FlashRankRequest(
            query=request.query,
            documents=[{"text": doc} for doc in request.documents]
        )
        
        # 执行 rerank
        results = ranker.rerank(flashrank_request)
        
        # 转换回响应格式
        rerank_results = [
            RerankResult(
                index=r["ref_id"],
                text=r["text"],
                score=r["score"]
            )
            for r in results
        ]
        
        # 如果指定了 top_k，截取结果
        if request.top_k:
            rerank_results = rerank_results[:request.top_k]
        
        logger.info(f"Reranked {len(request.documents)} documents -> {len(rerank_results)} results")
        
        return RerankResponse(results=rerank_results)
        
    except Exception as e:
        logger.error(f"Rerank error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/rerank")
async def rerank_get():
    """Health check for rerank endpoint"""
    return {"status": "rerank endpoint ready"}

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
