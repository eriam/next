FROM quay.io/jupyter/datascience-notebook:2024-05-27


# Debian package
RUN pip3 install plotly imageio openai jupyter_collaboration
# SAGE3 module
RUN pip3 install ws4py celery httpx rectpack networkx graphviz pysage3

RUN pip3 install redis

RUN pip3  install jupyter_collaboration
