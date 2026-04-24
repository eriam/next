import os
import requests
from dotenv import load_dotenv
from urllib.parse import urlparse, urlunparse, urlencode

# Load environment variables from .env file
load_dotenv()


def validate_env_vars():
    """
    Ensure that all required environment variables are set.
    Adjusts defaults or raises errors when necessary.
    """
    missing_vars = []
    
    # ENVIRONMENT: default to development if not provided
    if not os.getenv("ENVIRONMENT"):
        print("Warning: ENVIRONMENT not set. Defaulting to 'development'.")
        os.environ["ENVIRONMENT"] = "development"
    
    # Determine the Jupyter hub type (LOCAL or SAGE3)
    jupyter_hub_type = os.getenv("JUPYTER_HUB_TYPE", "LOCAL")
    if jupyter_hub_type not in ("LOCAL", "SAGE3"):
        raise ValueError("JUPYTER_HUB_TYPE must be either 'LOCAL' or 'SAGE3'.")
    
    # For LOCAL, require JUPYTER_TOKEN; for SAGE3, require TOKEN and SAGE3_SERVER.
    if jupyter_hub_type == "LOCAL":
        if not os.getenv("JUPYTER_TOKEN"):
            missing_vars.append("JUPYTER_TOKEN")
    elif jupyter_hub_type == "SAGE3":
        if not os.getenv("TOKEN"):
            missing_vars.append("TOKEN")
        if not os.getenv("SAGE3_SERVER"):
            missing_vars.append("SAGE3_SERVER")
    
    if missing_vars:
        raise EnvironmentError("Missing required environment variables: " + ", ".join(missing_vars))
    
    return jupyter_hub_type


def get_sage3_token():
    """
    Retrieve the Jupyter token from the Sage3 server configuration endpoint.
    """
    SAGE3_JWT_TOKEN = os.getenv("TOKEN")
    if not SAGE3_JWT_TOKEN:
        raise EnvironmentError("TOKEN environment variable is not set.")
    
    production = os.getenv("ENVIRONMENT") == "production"
    SAGE3_SERVER = os.getenv("SAGE3_SERVER", "localhost:3333")
    protocol = "https://" if production else "http://"
    node_url = protocol + SAGE3_SERVER

    # Construct the configuration URL
    config_url = node_url + "/api/configuration"
    headers = {"Authorization": f"Bearer {SAGE3_JWT_TOKEN}"}
    
    try:
        response = requests.get(config_url, headers=headers, verify=False)
        response.raise_for_status()  # Raises HTTPError for 4xx/5xx responses
    except requests.RequestException as e:
        raise ConnectionError(f"Error connecting to {config_url}: {e}")
    
    try:
        data = response.json()
    except ValueError as e:
        raise ValueError(f"Error parsing JSON response from {config_url}: {e}")
    
    if "token" not in data:
        raise KeyError(f"'token' not found in the response from {config_url}")
    
    return data["token"]


def get_jupyter_token(jupyter_hub_type="LOCAL"):
    """
    Retrieve the Jupyter token based on the specified hub type.
    """
    if jupyter_hub_type == "LOCAL":
        token = os.getenv("JUPYTER_TOKEN")
        if not token:
            raise EnvironmentError("JUPYTER_TOKEN environment variable is not set.")
        return token
    elif jupyter_hub_type == "SAGE3":
        token = get_sage3_token()
        if token:
            return token
        else:
            raise ValueError("Could not retrieve the Jupyter server token from Sage3.")
    else:
        raise ValueError("JUPYTER_HUB_TYPE must be either 'LOCAL' or 'SAGE3'.")


def build_jupyter_url(url):
    """
    Build a valid Jupyter URL by appending the token as a query parameter.

    Returns:
        parsed_url: The full URL parsed with the token as query.
        base_url: The URL without the query parameters.
    """
    jupyter_hub_type = os.getenv("JUPYTER_HUB_TYPE", "LOCAL")
    token = get_jupyter_token(jupyter_hub_type)
    
    if not token:
        raise ValueError("Token is empty, cannot build URL.")
    
    # Properly encode the token in the query string
    query_string = urlencode({"token": token})
    
    # Parse the provided URL
    parsed_url = urlparse(url)
    
    # Reconstruct the URL with the token query parameter
    full_url = parsed_url._replace(query=query_string)
    final_url = full_url.geturl()
    
    # Validate the constructed URL
    validated_parsed_url = urlparse(final_url)
    if not all([validated_parsed_url.scheme, validated_parsed_url.netloc, validated_parsed_url.query]):
        raise ValueError("Constructed URL is invalid: " + final_url)
    
    base_url = urlunparse(
        (validated_parsed_url.scheme, validated_parsed_url.netloc, validated_parsed_url.path, "", "", "")
    )
    
    return validated_parsed_url, base_url


