"""
Integration tests for Jira API functionality.
These tests run against a real Jira instance.

Run with: pytest tests/test_jira_integration.py -v -s

Note: These tests require valid Jira credentials to be set.
"""
import pytest
import os

from app.jira_service import JiraService

# Test configuration - update these for your Jira instance
# IMPORTANT: Set these as environment variables. Never commit API tokens to git!
JIRA_URL = os.getenv("JIRA_URL", "https://roflander9.atlassian.net")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "ddairov56@gmail.com")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN")  # Must be set via environment variable

if not JIRA_API_TOKEN:
    raise ValueError("JIRA_API_TOKEN environment variable must be set for integration tests")


@pytest.fixture
def jira_service():
    """Create a JiraService instance for testing."""
    return JiraService(
        url=JIRA_URL,
        email=JIRA_EMAIL,
        api_token=JIRA_API_TOKEN
    )


class TestJiraConnection:
    """Test basic Jira connectivity."""
    
    def test_connection_succeeds(self, jira_service):
        """Test that we can connect to Jira."""
        result = jira_service.test_connection()
        assert result is True, "Failed to connect to Jira. Check credentials."


class TestJiraProjects:
    """Test project-related functionality."""
    
    def test_get_projects_returns_list(self, jira_service):
        """Test that we can retrieve projects."""
        projects = jira_service.get_projects()
        
        assert isinstance(projects, list), "Expected list of projects"
        print(f"\n📁 Found {len(projects)} projects:")
        for p in projects[:5]:  # Show first 5
            print(f"   - {p.get('key', 'N/A')}: {p.get('name', 'N/A')}")
        
        if projects:
            # Verify structure
            first_project = projects[0]
            assert 'key' in first_project, "Project should have 'key' field"


class TestJiraIssueTypes:
    """Test issue type functionality."""
    
    def test_get_issue_types_for_project(self, jira_service):
        """Test getting issue types for a project."""
        # First get a project
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        issue_types = jira_service.get_issue_types(project_key)
        
        assert isinstance(issue_types, list), "Expected list of issue types"
        print(f"\n📋 Issue types for {project_key}:")
        for it in issue_types:
            print(f"   - {it.get('name', 'N/A')}")


class TestJiraSearch:
    """Test search functionality."""
    
    def test_search_issues_with_project_filter(self, jira_service):
        """Test search with project filter (required by some Jira instances)."""
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        result = jira_service.search_issues(f"project = {project_key} ORDER BY created DESC", max_results=5)
        
        assert 'issues' in result, "Result should contain 'issues' key"
        assert 'total' in result, "Result should contain 'total' key"
        
        print(f"\n🔍 Search results in {project_key}: {result['total']} total issues")
        for issue in result['issues'][:5]:
            key = issue.get('key', 'N/A')
            summary = issue.get('fields', {}).get('summary', 'N/A')[:50]
            status = issue.get('fields', {}).get('status', {}).get('name', 'N/A')
            print(f"   - {key}: {summary}... [{status}]")
    
    def test_search_issues_text_search(self, jira_service):
        """Test text search with project filter."""
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        # Search for any issue with text (may return 0 results)
        result = jira_service.search_issues(f"project = {project_key}", max_results=3)
        
        assert 'issues' in result
        print(f"\n🔍 Issues in {project_key}: {result['total']} total")


class TestJiraGetIssue:
    """Test getting individual issues."""
    
    def test_get_issue_by_key(self, jira_service):
        """Test getting a specific issue by key."""
        # First get a project and search for an issue
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        result = jira_service.search_issues(f"project = {project_key} ORDER BY created DESC", max_results=1)
        if not result.get('issues'):
            pytest.skip("No issues available in project")
        
        issue_key = result['issues'][0]['key']
        issue = jira_service.get_issue(issue_key)
        
        assert issue.get('key') == issue_key
        assert 'fields' in issue
        
        print(f"\n📄 Issue {issue_key}:")
        print(f"   Summary: {issue['fields'].get('summary', 'N/A')}")
        print(f"   Status: {issue['fields'].get('status', {}).get('name', 'N/A')}")
        print(f"   Type: {issue['fields'].get('issuetype', {}).get('name', 'N/A')}")


class TestJiraTransitions:
    """Test workflow transitions."""
    
    def test_get_transitions_for_issue(self, jira_service):
        """Test getting available transitions for an issue."""
        # First get a project and search for an issue
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        result = jira_service.search_issues(f"project = {project_key} ORDER BY created DESC", max_results=1)
        if not result.get('issues'):
            pytest.skip("No issues available in project")
        
        issue_key = result['issues'][0]['key']
        transitions = jira_service.get_transitions(issue_key)
        
        assert isinstance(transitions, list)
        
        print(f"\n🔄 Available transitions for {issue_key}:")
        if not transitions:
            print("   (no transitions available)")
        else:
            for t in transitions:
                if isinstance(t, dict):
                    # 'to' can be either a string or a dict with 'name' key
                    to_status = t.get('to')
                    if isinstance(to_status, dict):
                        to_name = to_status.get('name', 'N/A')
                    else:
                        to_name = to_status or 'N/A'
                    print(f"   - [{t.get('id')}] {t.get('name')} → {to_name}")
                else:
                    print(f"   - {t}")


class TestJiraCreateAndComment:
    """Test create and comment functionality."""
    
    def test_create_issue(self, jira_service):
        """Test creating a new issue."""
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        issue_types = jira_service.get_issue_types(project_key)
        if not issue_types:
            pytest.skip("No issue types available")
        
        # Try to find 'Task' or use the first available type
        issue_type = None
        for it in issue_types:
            if it.get('name', '').lower() in ['task', 'задача']:
                issue_type = it.get('name')
                break
        if not issue_type:
            issue_type = issue_types[0].get('name')
        
        result = jira_service.create_issue(
            project_key=project_key,
            summary="[Test] Integration test issue - please delete",
            description="This is a test issue created by automated integration tests.",
            issue_type=issue_type
        )
        
        assert 'key' in result
        print(f"\n✅ Created issue: {result['key']}")
        
        # Store the key for cleanup or other tests
        return result['key']
    
    def test_add_comment(self, jira_service):
        """Test adding a comment to an issue."""
        # First get a project and search for an issue
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        result = jira_service.search_issues(f"project = {project_key} ORDER BY created DESC", max_results=1)
        if not result.get('issues'):
            pytest.skip("No issues available in project")
        
        issue_key = result['issues'][0]['key']
        
        comment_result = jira_service.add_comment(
            issue_key=issue_key,
            body="[Test] This is a test comment from integration tests."
        )
        
        assert comment_result is not None
        print(f"\n💬 Added comment to {issue_key}")


class TestJiraUpdateIssue:
    """Test issue update functionality."""
    
    def test_update_issue_summary(self, jira_service):
        """Test updating issue summary."""
        # First get a project and search for an issue
        projects = jira_service.get_projects()
        if not projects:
            pytest.skip("No projects available")
        
        project_key = projects[0].get('key')
        result = jira_service.search_issues(f"project = {project_key} ORDER BY created DESC", max_results=1)
        if not result.get('issues'):
            pytest.skip("No issues available in project")
        
        issue_key = result['issues'][0]['key']
        original_summary = result['issues'][0]['fields']['summary']
        
        # Only update if it's a test issue (to avoid modifying real issues)
        if '[Test]' not in original_summary:
            pytest.skip("Skipping update on non-test issue to avoid modifying real data")
        
        update_result = jira_service.update_issue(
            issue_key=issue_key,
            fields={"summary": f"{original_summary} [Updated]"}
        )
        
        assert update_result['status'] == 'success'
        print(f"\n✏️ Updated {issue_key}")


# Run a quick smoke test when executed directly
if __name__ == "__main__":
    print("🧪 Jira Integration Smoke Test")
    print("=" * 50)
    
    service = JiraService(
        url=JIRA_URL,
        email=JIRA_EMAIL,
        api_token=JIRA_API_TOKEN
    )
    
    print("\n1. Testing connection...")
    if service.test_connection():
        print("   ✅ Connection successful!")
    else:
        print("   ❌ Connection failed!")
        exit(1)
    
    print("\n2. Fetching projects...")
    projects = service.get_projects()
    print(f"   ✅ Found {len(projects)} projects")
    
    if projects:
        print("\n3. Fetching issue types...")
        project_key = projects[0].get('key')
        issue_types = service.get_issue_types(project_key)
        print(f"   ✅ Found {len(issue_types)} issue types for {project_key}")
        
        print("\n4. Searching issues...")
        search_result = service.search_issues(f"project = {project_key}", max_results=5)
        print(f"   ✅ Found {search_result['total']} issues in {project_key}")
        
        if search_result['issues']:
            print("\n5. Getting issue details...")
            issue_key = search_result['issues'][0]['key']
            issue = service.get_issue(issue_key)
            print(f"   ✅ Retrieved {issue_key}: {issue['fields'].get('summary', 'N/A')[:40]}...")
            
            print("\n6. Getting transitions...")
            transitions = service.get_transitions(issue_key)
            print(f"   ✅ Found {len(transitions)} available transitions")
    
    print("\n" + "=" * 50)
    print("🎉 All smoke tests passed!")

