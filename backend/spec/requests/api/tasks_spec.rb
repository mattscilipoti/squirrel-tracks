# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Api::Tasks', type: :request do
  let(:session) { create(:session) }

  describe 'POST /api/sessions/:session_id/tasks' do
    it 'creates a new task in a session' do
      post "/api/sessions/#{session.id}/tasks",
           params: { task: { name: 'Test Task', duration_minutes: 30 } },
           as: :json

      expect(response).to have_http_status(:created)
      json_response = JSON.parse(response.body)
      expect(json_response['name']).to eq('Test Task')
      expect(json_response['duration_minutes']).to eq(30)
      expect(json_response['session_id']).to eq(session.id)
    end

    it 'creates a task with default duration when not specified' do
      post "/api/sessions/#{session.id}/tasks",
           params: { task: { name: 'Quick Task' } },
           as: :json

      expect(response).to have_http_status(:created)
      json_response = JSON.parse(response.body)
      expect(json_response['duration_minutes']).to eq(0)
    end

    it 'returns validation error when name is missing' do
      post "/api/sessions/#{session.id}/tasks",
           params: { task: { duration_minutes: 30 } },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      json_response = JSON.parse(response.body)
      expect(json_response).to have_key('errors')
    end

    it 'returns 404 when session does not exist' do
      post '/api/sessions/999999/tasks',
           params: { task: { name: 'Test Task' } },
           as: :json

      expect(response).to have_http_status(:not_found)
      json_response = JSON.parse(response.body)
      expect(json_response).to have_key('error')
    end
  end

  describe 'PATCH /api/sessions/:session_id/tasks/:id' do
    let(:task) { create(:task, session: session, name: 'Original Task') }

    it 'updates task name' do
      patch "/api/sessions/#{session.id}/tasks/#{task.id}",
            params: { task: { name: 'Updated Task' } },
            as: :json

      expect(response).to have_http_status(:ok)
      json_response = JSON.parse(response.body)
      expect(json_response['name']).to eq('Updated Task')
    end

    it 'updates task duration' do
      patch "/api/sessions/#{session.id}/tasks/#{task.id}",
            params: { task: { duration_minutes: 45 } },
            as: :json

      expect(response).to have_http_status(:ok)
      json_response = JSON.parse(response.body)
      expect(json_response['duration_minutes']).to eq(45)
    end

    it 'returns 404 when session does not exist' do
      patch '/api/sessions/999999/tasks/1',
            params: { task: { name: 'Updated' } },
            as: :json

      expect(response).to have_http_status(:not_found)
    end

    it 'returns 404 when task does not exist' do
      patch "/api/sessions/#{session.id}/tasks/999999",
            params: { task: { name: 'Updated' } },
            as: :json

      expect(response).to have_http_status(:not_found)
    end
  end

  describe 'DELETE /api/sessions/:session_id/tasks/:id' do
    let(:task) { create(:task, session: session) }

    it 'deletes a task' do
      task_id = task.id

      delete "/api/sessions/#{session.id}/tasks/#{task_id}"

      expect(response).to have_http_status(:no_content)
      expect(Task.exists?(task_id)).to be_falsy
    end

    it 'returns 404 when session does not exist' do
      delete '/api/sessions/999999/tasks/1'

      expect(response).to have_http_status(:not_found)
    end

    it 'returns 404 when task does not exist' do
      delete "/api/sessions/#{session.id}/tasks/999999"

      expect(response).to have_http_status(:not_found)
    end
  end
end
