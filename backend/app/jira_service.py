import logging
from urllib.parse import urlparse

from atlassian import Jira
from atlassian.errors import ApiError

logger = logging.getLogger(__name__)


class JiraService:
    def __init__(self, url: str, email: str, api_token: str, jira_client: Jira | None = None):
        # Normalize and validate Jira URL
        url = url.strip().rstrip('/')
        
        # If URL contains /jira/ or other paths, extract just the base domain
        # Jira Cloud URLs should be like: https://your-domain.atlassian.net
        if '/jira/' in url or '/browse/' in url or '/projects/' in url:
            # Extract base URL from full Jira URL
            parsed = urlparse(url)
            # Reconstruct base URL: scheme + netloc
            url = f"{parsed.scheme}://{parsed.netloc}"
            logger.warning(f"Extracted base Jira URL from full URL: {url}")
        
        # Validate URL format
        if not url.startswith(('http://', 'https://')):
            raise ValueError(f"Invalid Jira URL format: {url}. Must start with http:// or https://")
        
        if '.atlassian.net' not in url and '.atlassian.com' not in url and 'jira' not in url.lower():
            logger.warning(f"Jira URL doesn't look like a standard Jira instance: {url}")
        
        self.url = url
        self.email = email
        self.api_token = api_token
        self._client = jira_client or Jira(
            url=self.url,
            username=email,
            password=api_token,
            cloud=True,
            advanced_mode=False,
        )
        logger.debug("Initialized JiraService using atlassian-python-api client")

    @staticmethod
    def _ensure_json(data):
        """Normalize Atlassian client responses to plain Python objects."""
        if data is None:
            return data
        json_attr = getattr(data, "json", None)
        if callable(json_attr):
            try:
                return json_attr()
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.error(f"Failed to parse Jira response JSON: {exc}")
                raise
        return data

    def test_connection(self) -> bool:
        """Test the connection to Jira"""
        try:
            self._client.myself()
            return True
        except Exception as e:
            logger.error(f"Jira connection test failed: {str(e)}")
            return False

    def get_projects(self):
        """Get list of accessible projects"""
        try:
            projects = self._ensure_json(self._client.projects())
            # Handle iterable responses
            if hasattr(projects, '__iter__') and not isinstance(projects, (str, bytes)):
                # If it's iterable (list/dict), use it directly
                projects = list(projects) if not isinstance(projects, dict) else projects
            # Ensure we return a list
            if isinstance(projects, dict):
                # If it's a dict, try to extract the projects list
                projects = projects.get('values', projects.get('projects', []))
            elif not isinstance(projects, list):
                projects = []
            return projects or []
        except ApiError as e:
            logger.error(f"Failed to get Jira projects: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get Jira projects: {str(e)}")
            raise

    def get_issue_types(self, project_id_or_key: str):
        """Get issue types for a project"""
        try:
            data = self._ensure_json(self._client.issue_createmeta(project_id_or_key))
            projects = data.get('projects', [])
            if projects:
                return projects[0].get('issuetypes', [])
            return []
        except ApiError as e:
            logger.error(f"Failed to get issue types: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get issue types: {str(e)}")
            raise

    def create_issue(self, project_key: str, summary: str, description: str, issue_type: str, 
                     assignee: str = None, labels: list = None, duedate: str = None, 
                     start_date: str = None, custom_fields: dict = None):
        """Create a Jira issue"""
        # Ensure description is a non-empty string
        description_text = str(description or "").strip() or "No description provided"
        
        # Use plain text description - atlassian-python-api handles conversion
        # if needed, or the Jira instance uses legacy format
        fields = {
            "project": {
                "key": project_key
            },
            "summary": summary,
            "description": description_text,
            "issuetype": {
                "name": issue_type
            }
        }
        
        # Add optional fields
        if assignee:
            if assignee == "-1":
                # Unassign
                fields["assignee"] = None
            else:
                fields["assignee"] = {"accountId": assignee}
        
        if labels:
            fields["labels"] = labels
        
        if duedate:
            fields["duedate"] = duedate
        
        if start_date:
            # Start date is often a custom field, but try standard field first
            # Common custom field IDs: customfield_10020, customfield_10015
            fields["customfield_10020"] = start_date  # Try common start date field
        
        # Add any additional custom fields
        if custom_fields:
            fields.update(custom_fields)
        
        payload = {"fields": fields}
        
        logger.debug(f"Creating Jira issue with payload: project={project_key}, summary={summary[:50]}..., issue_type={issue_type}")

        try:
            return self._client.create_issue(fields=payload["fields"])
        except ApiError as e:
            logger.error(f"Failed to create Jira issue: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to create Jira issue: {str(e)}")
            raise

    def search_issues(self, jql: str, max_results: int = 50):
        """Search for issues using JQL query"""
        try:
            logger.debug(f"Searching Jira issues with JQL: {jql}, max_results={max_results}")
            result = self._ensure_json(self._client.jql(jql, limit=max_results))
            # The jql method returns a dict with 'issues' key
            if isinstance(result, dict):
                issues = result.get('issues', [])
                return {
                    'issues': issues,
                    'total': result.get('total', len(issues)),
                    'maxResults': result.get('maxResults', max_results)
                }
            return {'issues': [], 'total': 0, 'maxResults': max_results}
        except ApiError as e:
            logger.error(f"Failed to search Jira issues: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to search Jira issues: {str(e)}")
            raise

    def get_issue(self, issue_key: str):
        """Get full details of a specific issue"""
        try:
            logger.debug(f"Getting Jira issue: {issue_key}")
            result = self._ensure_json(self._client.issue(issue_key))
            return result
        except ApiError as e:
            logger.error(f"Failed to get Jira issue {issue_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get Jira issue {issue_key}: {str(e)}")
            raise

    def update_issue(self, issue_key: str, fields: dict):
        """Update fields of an existing issue"""
        try:
            logger.debug(f"Updating Jira issue {issue_key} with fields: {list(fields.keys())}")
            # Build the update payload - only include non-None fields
            update_fields = {}
            
            if 'summary' in fields and fields['summary']:
                update_fields['summary'] = fields['summary']
            if 'description' in fields and fields['description'] is not None:
                update_fields['description'] = fields['description']
            if 'priority' in fields and fields['priority']:
                update_fields['priority'] = {'name': fields['priority']}
            
            # Handle assignee - "-1" means unassign
            if 'assignee' in fields:
                if fields['assignee'] == "-1" or fields['assignee'] is None:
                    update_fields['assignee'] = None
                elif fields['assignee']:
                    # For Jira Cloud, assignee needs accountId
                    update_fields['assignee'] = {'accountId': fields['assignee']}
            
            # Handle labels
            if 'labels' in fields and fields['labels']:
                update_fields['labels'] = fields['labels']
            
            # Handle due date
            if 'duedate' in fields and fields['duedate']:
                update_fields['duedate'] = fields['duedate']
            
            # Handle start date (common custom field)
            if 'customfield_10020' in fields and fields['customfield_10020']:
                update_fields['customfield_10020'] = fields['customfield_10020']
            
            # Handle any other custom fields (fields starting with "customfield_")
            for key, value in fields.items():
                if key.startswith('customfield_') and value is not None:
                    update_fields[key] = value
            
            if not update_fields:
                logger.warning(f"No valid fields to update for issue {issue_key}")
                return {'status': 'no_changes', 'message': 'No valid fields provided for update'}
            
            result = self._client.update_issue_field(issue_key, update_fields)
            return {'status': 'success', 'message': f'Issue {issue_key} updated successfully'}
        except ApiError as e:
            logger.error(f"Failed to update Jira issue {issue_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to update Jira issue {issue_key}: {str(e)}")
            raise

    def add_comment(self, issue_key: str, body: str):
        """Add a comment to an issue"""
        try:
            logger.debug(f"Adding comment to Jira issue {issue_key}")
            result = self._ensure_json(self._client.issue_add_comment(issue_key, body))
            return result
        except ApiError as e:
            logger.error(f"Failed to add comment to issue {issue_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to add comment to issue {issue_key}: {str(e)}")
            raise

    def get_transitions(self, issue_key: str):
        """Get available workflow transitions for an issue"""
        try:
            logger.debug(f"Getting transitions for Jira issue {issue_key}")
            result = self._ensure_json(self._client.get_issue_transitions(issue_key))
            # Returns list of transitions with id, name, and other details
            if isinstance(result, list):
                return result
            elif isinstance(result, dict):
                return result.get('transitions', [])
            return []
        except ApiError as e:
            logger.error(f"Failed to get transitions for issue {issue_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get transitions for issue {issue_key}: {str(e)}")
            raise

    def transition_issue(self, issue_key: str, transition_id: str, comment: str = None):
        """Execute a workflow transition on an issue"""
        try:
            logger.debug(f"Transitioning Jira issue {issue_key} with transition_id={transition_id}")
            # The issue_transition method handles the transition
            if comment:
                result = self._client.issue_transition(issue_key, transition_id, comment=comment)
            else:
                result = self._client.issue_transition(issue_key, transition_id)
            return {'status': 'success', 'message': f'Issue {issue_key} transitioned successfully'}
        except ApiError as e:
            logger.error(f"Failed to transition issue {issue_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to transition issue {issue_key}: {str(e)}")
            raise

    # === Context Methods for Enhanced LLM Task Generation ===

    def get_all_fields(self):
        """Get all fields (system + custom) from Jira"""
        try:
            logger.debug("Getting all Jira fields")
            result = self._ensure_json(self._client.get_all_fields())
            if isinstance(result, list):
                return result
            return []
        except ApiError as e:
            logger.error(f"Failed to get Jira fields: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get Jira fields: {str(e)}")
            raise

    def get_project_users(self, project_key: str):
        """Get users assignable to a project"""
        try:
            logger.debug(f"Getting assignable users for project {project_key}")
            # Use the project_actors method or search for assignable users
            result = self._ensure_json(
                self._client.get_all_assignable_users_for_project(project_key)
            )
            if isinstance(result, list):
                # Extract relevant user info
                users = []
                for user in result:
                    users.append({
                        'accountId': user.get('accountId'),
                        'displayName': user.get('displayName'),
                        'emailAddress': user.get('emailAddress', ''),
                        'active': user.get('active', True)
                    })
                return users
            return []
        except ApiError as e:
            logger.error(f"Failed to get project users for {project_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get project users for {project_key}: {str(e)}")
            raise

    def get_project_labels(self, project_key: str, limit: int = 20):
        """Get commonly used labels by searching recent issues in the project"""
        try:
            logger.debug(f"Getting labels for project {project_key}")
            # Search recent issues to extract unique labels
            jql = f"project = {project_key} AND labels IS NOT EMPTY ORDER BY updated DESC"
            result = self.search_issues(jql, max_results=limit)
            
            # Extract unique labels from issues
            labels_set = set()
            for issue in result.get('issues', []):
                issue_labels = issue.get('fields', {}).get('labels', [])
                if issue_labels:
                    labels_set.update(issue_labels)
            
            return sorted(list(labels_set))
        except ApiError as e:
            logger.error(f"Failed to get project labels for {project_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get project labels for {project_key}: {str(e)}")
            raise

    def get_recent_issues(self, project_key: str, limit: int = 15):
        """Get recent issues for duplicate detection"""
        try:
            logger.debug(f"Getting recent issues for project {project_key}")
            jql = f"project = {project_key} ORDER BY updated DESC"
            result = self.search_issues(jql, max_results=limit)
            
            # Extract simplified issue info for LLM context
            issues = []
            for issue in result.get('issues', []):
                fields = issue.get('fields', {})
                issues.append({
                    'key': issue.get('key'),
                    'summary': fields.get('summary', ''),
                    'status': fields.get('status', {}).get('name', ''),
                    'issueType': fields.get('issuetype', {}).get('name', ''),
                    'priority': fields.get('priority', {}).get('name', '') if fields.get('priority') else '',
                    'assignee': fields.get('assignee', {}).get('displayName', 'Unassigned') if fields.get('assignee') else 'Unassigned'
                })
            return issues
        except ApiError as e:
            logger.error(f"Failed to get recent issues for {project_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get recent issues for {project_key}: {str(e)}")
            raise

    def get_priorities(self):
        """Get available priority levels from Jira"""
        try:
            logger.debug("Getting Jira priorities")
            result = self._ensure_json(self._client.get_all_priorities())
            if isinstance(result, list):
                return [{'id': p.get('id'), 'name': p.get('name')} for p in result if p.get('name')]
            return []
        except ApiError as e:
            logger.error(f"Failed to get Jira priorities: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to get Jira priorities: {str(e)}")
            raise

    def get_project_context(self, project_key: str) -> dict:
        """
        Fetch comprehensive project context for LLM task generation.
        Returns: issue_types, users, labels, recent_issues, custom_fields, priorities
        """
        try:
            logger.info(f"Fetching project context for {project_key}")
            context = {
                'project_key': project_key,
                'issue_types': [],
                'users': [],
                'labels': [],
                'recent_issues': [],
                'custom_fields': [],
                'priorities': []
            }
            
            # Get issue types for the project
            try:
                context['issue_types'] = self.get_issue_types(project_key)
            except Exception as e:
                logger.warning(f"Failed to get issue types: {e}")
            
            # Get assignable users
            try:
                context['users'] = self.get_project_users(project_key)
            except Exception as e:
                logger.warning(f"Failed to get project users: {e}")
            
            # Get commonly used labels
            try:
                context['labels'] = self.get_project_labels(project_key)
            except Exception as e:
                logger.warning(f"Failed to get project labels: {e}")
            
            # Get recent issues for duplicate detection
            try:
                context['recent_issues'] = self.get_recent_issues(project_key)
            except Exception as e:
                logger.warning(f"Failed to get recent issues: {e}")
            
            # Get custom fields (filter to relevant ones)
            try:
                all_fields = self.get_all_fields()
                # Filter to custom fields only
                context['custom_fields'] = [
                    {
                        'id': f.get('id'),
                        'name': f.get('name'),
                        'type': f.get('schema', {}).get('type', 'unknown') if f.get('schema') else 'unknown'
                    }
                    for f in all_fields
                    if f.get('id', '').startswith('customfield_') and f.get('name')
                ]
            except Exception as e:
                logger.warning(f"Failed to get custom fields: {e}")
            
            # Get available priorities
            try:
                context['priorities'] = self.get_priorities()
            except Exception as e:
                logger.warning(f"Failed to get priorities: {e}")
            
            logger.info(f"Project context fetched: {len(context['issue_types'])} issue types, "
                       f"{len(context['users'])} users, {len(context['labels'])} labels, "
                       f"{len(context['recent_issues'])} recent issues, {len(context['custom_fields'])} custom fields, "
                       f"{len(context['priorities'])} priorities")
            
            return context
        except Exception as e:
            logger.error(f"Failed to get project context for {project_key}: {str(e)}")
            raise
