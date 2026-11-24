"""Cases API 端点测试"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from nooshare_cases.web.main import app


@pytest_asyncio.fixture
async def client():
    """创建测试客户端"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    """测试健康检查端点"""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_cases_list(client: AsyncClient):
    """测试 cases 列表 API"""
    response = await client.get("/api/cases")
    assert response.status_code == 200
    data = response.json()
    assert "cases" in data
    assert "footer" in data
    assert isinstance(data["cases"], list)
    assert "total" in data["footer"]


@pytest.mark.asyncio
async def test_cases_list_with_status_filter(client: AsyncClient):
    """测试 cases 列表按状态筛选"""
    response = await client.get("/api/cases?status=researching")
    assert response.status_code == 200
    data = response.json()
    for case in data["cases"]:
        assert case["status"] == "researching"


@pytest.mark.asyncio
async def test_cases_list_with_view_filter(client: AsyncClient):
    """测试 cases 列表按视图筛选"""
    response = await client.get("/api/cases?view=fixture")
    assert response.status_code == 200
    data = response.json()
    for case in data["cases"]:
        assert case["isFixture"] is True


@pytest.mark.asyncio
async def test_case_detail(client: AsyncClient):
    """测试 case 详情 API"""
    # 先获取列表找到一个 case
    list_response = await client.get("/api/cases")
    cases = list_response.json()["cases"]
    if not cases:
        pytest.skip("No cases available")
    
    case_id = cases[0]["caseId"]
    response = await client.get(f"/api/cases/{case_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["case"]["caseId"] == case_id
    assert "revisions" in data
    assert "companies" in data
    assert "evidence" in data
    assert "reviews" in data
    assert "observations" in data


@pytest.mark.asyncio
async def test_case_detail_not_found(client: AsyncClient):
    """测试 case 详情 404"""
    response = await client.get("/api/cases/NONEXISTENT")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_runs_list(client: AsyncClient):
    """测试 runs 列表 API"""
    response = await client.get("/api/runs")
    assert response.status_code == 200
    data = response.json()
    assert "runs" in data
    assert "footer" in data
    assert isinstance(data["runs"], list)


@pytest.mark.asyncio
async def test_runs_list_with_status_filter(client: AsyncClient):
    """测试 runs 列表按状态筛选"""
    response = await client.get("/api/runs?status=completed")
    assert response.status_code == 200
    data = response.json()
    for run in data["runs"]:
        assert run["status"] == "completed"


@pytest.mark.asyncio
async def test_run_detail(client: AsyncClient):
    """测试 run 详情 API"""
    # 先获取列表找到一个 run
    list_response = await client.get("/api/runs")
    runs = list_response.json()["runs"]
    if not runs:
        pytest.skip("No runs available")
    
    run_id = runs[0]["runId"]
    response = await client.get(f"/api/runs/{run_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["run"]["runId"] == run_id


@pytest.mark.asyncio
async def test_run_detail_not_found(client: AsyncClient):
    """测试 run 详情 404"""
    response = await client.get("/api/runs/NONEXISTENT")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_search(client: AsyncClient):
    """测试搜索 API"""
    response = await client.get("/api/search?q=test")
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "test"
    assert "observations" in data
    assert "episodes" in data
    assert "cases" in data
    assert "runs" in data


@pytest.mark.asyncio
async def test_search_empty_query(client: AsyncClient):
    """测试搜索空查询"""
    response = await client.get("/api/search?q=")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_review_invalid_decision(client: AsyncClient):
    """测试审核无效决策"""
    # 先获取一个 case
    list_response = await client.get("/api/cases")
    cases = list_response.json()["cases"]
    if not cases:
        pytest.skip("No cases available")
    
    case_id = cases[0]["caseId"]
    response = await client.post(
        f"/api/cases/{case_id}/review",
        json={"decision": "invalid"}
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_observation_invalid_outcome(client: AsyncClient):
    """测试观察无效结果"""
    # 先获取一个 frozen 或 observing 状态的 case
    list_response = await client.get("/api/cases?status=frozen,observing")
    cases = list_response.json()["cases"]
    if not cases:
        pytest.skip("No frozen/observing cases available")
    
    case_id = cases[0]["caseId"]
    response = await client.post(
        f"/api/cases/{case_id}/observations",
        json={
            "windowStart": "2024-01-01T00:00:00Z",
            "windowEnd": "2024-01-31T23:59:59Z",
            "outcome": "invalid",
            "content": "Test observation"
        }
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_observation_invalid_window(client: AsyncClient):
    """测试观察无效时间窗口"""
    # 先获取一个 frozen 或 observing 状态的 case
    list_response = await client.get("/api/cases?status=frozen,observing")
    cases = list_response.json()["cases"]
    if not cases:
        pytest.skip("No frozen/observing cases available")
    
    case_id = cases[0]["caseId"]
    response = await client.post(
        f"/api/cases/{case_id}/observations",
        json={
            "windowStart": "2024-01-31T23:59:59Z",
            "windowEnd": "2024-01-01T00:00:00Z",  # 结束早于开始
            "outcome": "support",
            "content": "Test observation"
        }
    )
    assert response.status_code == 400
