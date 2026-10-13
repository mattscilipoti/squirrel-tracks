require 'rails/all'

Bundler.require(*Rails.groups)

module EttApi
  class Application < Rails::Application
    config.load_defaults 7.1
    config.api_only = true
    
    # CORS configuration
    config.middleware.insert_before 0, Rack::Cors do
      allow do
        origins 'localhost:3000', 'localhost:5000', '127.0.0.1:3000'
        resource '*', headers: :any, methods: [:get, :post, :put, :patch, :delete, :options]
      end
    end

    config.generators.system_tests = nil
  end
end
