# ETT Development Container
# Based on Ruby 3.3.0 with SQLite, Node.js, and all dev tools

FROM ruby:3.3.0-slim

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV RAILS_ENV=development

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    wget \
    vim \
    sqlite3 \
    libsqlite3-dev \
    nodejs \
    npm \
    yarn \
    pkg-config \
    libssl-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Bundler
RUN gem install bundler

# Create app directory
WORKDIR /workspace/ett

# Set up shell environment
RUN echo 'export PS1="\[\033[01;32m\]dev\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> ~/.bashrc

# Pre-install common gems globally (optional optimization)
RUN gem install rails bundler

# Create directories
RUN mkdir -p /workspace/ett/backend \
    && mkdir -p /workspace/ett/web-frontend \
    && mkdir -p /workspace/ett/ios-app

# Default to bash
CMD ["/bin/bash"]
