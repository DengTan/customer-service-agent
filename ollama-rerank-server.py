#!/usr/bin/env python
"""
Ollama Embedding Rerank Service
使用 Ollama embedding 模型计算 query-document 相似度实现 rerank

启动命令: python ollama-rerank-server.py
默认端口: 8001

API 格式:
POST /rerank
{
  "query": "用户问题",
  "documents": ["文档1", "文档2", ...]
}
"""
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import httpx
import numpy as np
import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Ollama Embedding Rerank Service")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 配置
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_EMBED_MODEL = "bge-m3:567m"  # 使用已有的 embedding 模型

# 请求/响应模型
class RerankRequest(BaseModel):
    query: str
    documents: List[str]
    top_n: int = None

class RerankResult(BaseModel):
    index: int
    text: str
    score: float

class RerankResponse(BaseModel):
    results: List[RerankResult]

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """计算余弦相似度"""
    a = np.array(a)
    b = np.array(b)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))

@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "Ollama Embedding Rerank Service",
        "model": OLLAMA_EMBED_MODEL,
        "port": 8001
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest):
    """使用 Ollama embedding 计算相似度进行 rerank"""
    try:
        if not request.documents:
            return RerankResponse(results=[])
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            # 1. 获取 query 的 embedding
            query_resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/embeddings",
                json={"model": OLLAMA_EMBED_MODEL, "prompt": request.query}
            )
            query_resp.raise_for_status()
            query_emb = query_resp.json()["embedding"]
            
            # 2. 并行获取所有文档的 embedding
            doc_tasks = [
                client.post(
                    f"{OLLAMA_BASE_URL}/api/embeddings",
                    json={"model": OLLAMA_EMBED_MODEL, "prompt": doc}
                )
                for doc in request.documents
            ]
            doc_responses = await asyncio.gather(*doc_tasks, return_exceptions=True)
            
            # 3. 计算相似度分数
            scores = []
            for i, (doc, resp) in enumerate(zip(request.documents, doc_responses)):
                if isinstance(resp, Exception):
                    logger.error(f"Error embedding doc {i}: {resp}")
                    scores.append(0.0)
                else:
                    try:
                        resp.raise_for_status()
                        doc_emb = resp.json()["embedding"]
                        score = cosine_similarity(query_emb, doc_emb)
                        scores.append(score)
                    except Exception as e:
                        logger.error(f"Error processing doc {i}: {e}")
                        scores.append(0.0)
        
        # 4. 按分数排序
        doc_scores = list(zip(request.documents, scores, range(len(request.documents))))
        doc_scores.sort(key=lambda x: x[1], reverse=True)
        
        # 5. 构建结果
        top_n = request.top_n if request.top_n else len(doc_scores)
        results = [
            RerankResult(
                index=original_idx,
                text=doc,
                score=score
            )
            for doc, score, original_idx in doc_scores[:top_n]
        ]
        
        logger.info(f"Reranked {len(request.documents)} documents -> {len(results)} results")
        
        return RerankResponse(results=results)
        
    except Exception as e:
        logger.error(f"Rerank error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import asyncio
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        log_level="info"
    )
