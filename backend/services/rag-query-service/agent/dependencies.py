# This module will hold shared resources that are initialized at startup.
# It allows our tools to access things like the database connection
# without creating complex dependencies or circular imports.

db_connection = None
embedding_model = None 