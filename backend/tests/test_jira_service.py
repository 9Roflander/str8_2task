import pytest

from app.jira_service import JiraService


class StubJiraClient:
    def __init__(self):
        self.projects_result = []
        self.createmeta_result = {"projects": []}
        self.created_issue_payload = None
        self.should_fail_myself = False
        self.jql_result = {"issues": [], "total": 0}
        self.issue_result = {}
        self.update_issue_calls = []
        self.comment_calls = []
        self.transitions_result = []
        self.transition_calls = []

    def myself(self):
        if self.should_fail_myself:
            raise RuntimeError("boom")
        return {"accountId": "123"}

    def projects(self):
        return self.projects_result

    def issue_createmeta(self, project_id_or_key):
        return self.createmeta_result

    def create_issue(self, *, fields, update_history=False, update=None):
        self.created_issue_payload = fields
        return {"id": "100", "key": "TEST-1"}

    def jql(self, jql_query, limit=50):
        return self.jql_result

    def issue(self, issue_key):
        return self.issue_result

    def update_issue_field(self, issue_key, fields):
        self.update_issue_calls.append({"issue_key": issue_key, "fields": fields})
        return None

    def issue_add_comment(self, issue_key, body):
        self.comment_calls.append({"issue_key": issue_key, "body": body})
        return {"id": "10001", "body": body}

    def get_issue_transitions(self, issue_key):
        return self.transitions_result

    def issue_transition(self, issue_key, transition_id, comment=None):
        self.transition_calls.append({
            "issue_key": issue_key,
            "transition_id": transition_id,
            "comment": comment
        })
        return None


def _service_with_stub(stub: StubJiraClient) -> JiraService:
    return JiraService(
        url="https://example.atlassian.net",
        email="user@example.com",
        api_token="token",
        jira_client=stub,
    )


class DummyResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


# === Existing Tests ===

def test_get_projects_returns_client_results():
    stub = StubJiraClient()
    stub.projects_result = [{"key": "ABC"}, {"key": "XYZ"}]
    service = _service_with_stub(stub)

    projects = service.get_projects()

    assert projects == stub.projects_result


def test_get_issue_types_returns_first_project_issue_types():
    stub = StubJiraClient()
    stub.createmeta_result = {
        "projects": [
            {"issuetypes": [{"name": "Bug"}, {"name": "Task"}]},
        ]
    }
    service = _service_with_stub(stub)

    issue_types = service.get_issue_types("ABC")

    assert issue_types == [{"name": "Bug"}, {"name": "Task"}]


def test_get_issue_types_returns_empty_for_no_projects():
    stub = StubJiraClient()
    stub.createmeta_result = {"projects": []}
    service = _service_with_stub(stub)

    issue_types = service.get_issue_types("ABC")

    assert issue_types == []


def test_get_projects_handles_response_objects():
    stub = StubJiraClient()
    stub.projects_result = DummyResponse([{"key": "ABC", "name": "Alpha"}])
    service = _service_with_stub(stub)

    projects = service.get_projects()

    assert projects == [{"key": "ABC", "name": "Alpha"}]


def test_get_issue_types_handles_response_objects():
    stub = StubJiraClient()
    stub.createmeta_result = DummyResponse(
        {"projects": [{"issuetypes": [{"name": "Bug"}, {"name": "Task"}]}]}
    )
    service = _service_with_stub(stub)

    issue_types = service.get_issue_types("ABC")

    assert issue_types == [{"name": "Bug"}, {"name": "Task"}]


def test_create_issue_sends_plain_text_payload():
    """Test that create_issue sends plain text description (not ADF)."""
    stub = StubJiraClient()
    service = _service_with_stub(stub)

    result = service.create_issue("ABC", "Summary", "Details", "Task")

    assert result == {"id": "100", "key": "TEST-1"}
    assert stub.created_issue_payload["project"]["key"] == "ABC"
    assert stub.created_issue_payload["summary"] == "Summary"
    assert stub.created_issue_payload["issuetype"]["name"] == "Task"
    # Description should be plain text, not ADF
    assert stub.created_issue_payload["description"] == "Details"


def test_create_issue_with_empty_description():
    """Test that empty description gets default text."""
    stub = StubJiraClient()
    service = _service_with_stub(stub)

    service.create_issue("ABC", "Summary", "", "Task")

    assert stub.created_issue_payload["description"] == "No description provided"


def test_create_issue_with_none_description():
    """Test that None description gets default text."""
    stub = StubJiraClient()
    service = _service_with_stub(stub)

    service.create_issue("ABC", "Summary", None, "Task")

    assert stub.created_issue_payload["description"] == "No description provided"


@pytest.mark.parametrize("should_fail, expected", [(False, True), (True, False)])
def test_test_connection_handles_client_errors(should_fail, expected):
    stub = StubJiraClient()
    stub.should_fail_myself = should_fail
    service = _service_with_stub(stub)

    assert service.test_connection() is expected


# === New Tests for Phase 1 Enhancements ===

class TestSearchIssues:
    def test_search_issues_returns_results(self):
        stub = StubJiraClient()
        stub.jql_result = {
            "issues": [
                {"key": "TEST-1", "fields": {"summary": "Issue 1"}},
                {"key": "TEST-2", "fields": {"summary": "Issue 2"}},
            ],
            "total": 2,
            "maxResults": 50
        }
        service = _service_with_stub(stub)

        result = service.search_issues("project = TEST")

        assert result["total"] == 2
        assert len(result["issues"]) == 2
        assert result["issues"][0]["key"] == "TEST-1"

    def test_search_issues_handles_empty_results(self):
        stub = StubJiraClient()
        stub.jql_result = {"issues": [], "total": 0}
        service = _service_with_stub(stub)

        result = service.search_issues("project = TEST")

        assert result["total"] == 0
        assert result["issues"] == []

    def test_search_issues_handles_response_object(self):
        stub = StubJiraClient()
        stub.jql_result = DummyResponse({
            "issues": [{"key": "TEST-1"}],
            "total": 1
        })
        service = _service_with_stub(stub)

        result = service.search_issues("key = TEST-1")

        assert result["total"] == 1


class TestGetIssue:
    def test_get_issue_returns_issue_data(self):
        stub = StubJiraClient()
        stub.issue_result = {
            "key": "TEST-1",
            "id": "10001",
            "fields": {
                "summary": "Test Issue",
                "status": {"name": "Open"}
            }
        }
        service = _service_with_stub(stub)

        result = service.get_issue("TEST-1")

        assert result["key"] == "TEST-1"
        assert result["fields"]["summary"] == "Test Issue"

    def test_get_issue_handles_response_object(self):
        stub = StubJiraClient()
        stub.issue_result = DummyResponse({
            "key": "TEST-1",
            "fields": {"summary": "Test"}
        })
        service = _service_with_stub(stub)

        result = service.get_issue("TEST-1")

        assert result["key"] == "TEST-1"


class TestUpdateIssue:
    def test_update_issue_with_summary(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.update_issue("TEST-1", {"summary": "New Summary"})

        assert result["status"] == "success"
        assert len(stub.update_issue_calls) == 1
        assert stub.update_issue_calls[0]["fields"]["summary"] == "New Summary"

    def test_update_issue_with_priority(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.update_issue("TEST-1", {"priority": "High"})

        assert result["status"] == "success"
        assert stub.update_issue_calls[0]["fields"]["priority"] == {"name": "High"}

    def test_update_issue_with_assignee(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.update_issue("TEST-1", {"assignee": "account123"})

        assert result["status"] == "success"
        assert stub.update_issue_calls[0]["fields"]["assignee"] == {"accountId": "account123"}

    def test_update_issue_with_no_valid_fields(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.update_issue("TEST-1", {})

        assert result["status"] == "no_changes"
        assert len(stub.update_issue_calls) == 0

    def test_update_issue_filters_none_values(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.update_issue("TEST-1", {
            "summary": "New",
            "description": None,
            "priority": ""
        })

        assert result["status"] == "success"
        # Only summary should be in the call since description is None and priority is empty
        assert "summary" in stub.update_issue_calls[0]["fields"]
        assert "description" not in stub.update_issue_calls[0]["fields"]


class TestAddComment:
    def test_add_comment_success(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.add_comment("TEST-1", "This is a comment")

        assert result["body"] == "This is a comment"
        assert len(stub.comment_calls) == 1
        assert stub.comment_calls[0]["issue_key"] == "TEST-1"
        assert stub.comment_calls[0]["body"] == "This is a comment"

    def test_add_comment_handles_response_object(self):
        stub = StubJiraClient()
        # Override the method to return a DummyResponse
        original_add = stub.issue_add_comment
        stub.issue_add_comment = lambda key, body: DummyResponse({"id": "123", "body": body})
        service = _service_with_stub(stub)

        result = service.add_comment("TEST-1", "Comment")

        assert result["body"] == "Comment"


class TestGetTransitions:
    def test_get_transitions_returns_list(self):
        stub = StubJiraClient()
        stub.transitions_result = [
            {"id": "11", "name": "Start Progress", "to": {"name": "In Progress"}},
            {"id": "21", "name": "Done", "to": {"name": "Done"}},
        ]
        service = _service_with_stub(stub)

        result = service.get_transitions("TEST-1")

        assert len(result) == 2
        assert result[0]["name"] == "Start Progress"

    def test_get_transitions_handles_dict_response(self):
        stub = StubJiraClient()
        stub.transitions_result = DummyResponse({
            "transitions": [{"id": "11", "name": "Done"}]
        })
        service = _service_with_stub(stub)

        result = service.get_transitions("TEST-1")

        assert result == [{"id": "11", "name": "Done"}]

    def test_get_transitions_handles_empty_list(self):
        stub = StubJiraClient()
        stub.transitions_result = []
        service = _service_with_stub(stub)

        result = service.get_transitions("TEST-1")

        assert result == []


class TestTransitionIssue:
    def test_transition_issue_without_comment(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.transition_issue("TEST-1", "21")

        assert result["status"] == "success"
        assert len(stub.transition_calls) == 1
        assert stub.transition_calls[0]["issue_key"] == "TEST-1"
        assert stub.transition_calls[0]["transition_id"] == "21"
        assert stub.transition_calls[0]["comment"] is None

    def test_transition_issue_with_comment(self):
        stub = StubJiraClient()
        service = _service_with_stub(stub)

        result = service.transition_issue("TEST-1", "21", "Completing task")

        assert result["status"] == "success"
        assert stub.transition_calls[0]["comment"] == "Completing task"


# === URL Validation Tests ===

class TestJiraServiceInit:
    def test_accepts_valid_atlassian_url(self):
        service = JiraService(
            url="https://mycompany.atlassian.net",
            email="test@example.com",
            api_token="token",
            jira_client=StubJiraClient()
        )
        assert service.url == "https://mycompany.atlassian.net"

    def test_strips_trailing_slash(self):
        service = JiraService(
            url="https://mycompany.atlassian.net/",
            email="test@example.com",
            api_token="token",
            jira_client=StubJiraClient()
        )
        assert service.url == "https://mycompany.atlassian.net"

    def test_extracts_base_url_from_browse_url(self):
        service = JiraService(
            url="https://mycompany.atlassian.net/browse/TEST-1",
            email="test@example.com",
            api_token="token",
            jira_client=StubJiraClient()
        )
        assert service.url == "https://mycompany.atlassian.net"

    def test_extracts_base_url_from_jira_path(self):
        service = JiraService(
            url="https://mycompany.atlassian.net/jira/software/projects/TEST",
            email="test@example.com",
            api_token="token",
            jira_client=StubJiraClient()
        )
        assert service.url == "https://mycompany.atlassian.net"

    def test_rejects_invalid_url_format(self):
        with pytest.raises(ValueError, match="Invalid Jira URL format"):
            JiraService(
                url="not-a-url",
                email="test@example.com",
                api_token="token",
                jira_client=StubJiraClient()
            )
