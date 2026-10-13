# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Api::Sessions', type: :request do
  describe 'POST /api/sessions' do
    it 'creates a new session with active status' do
      post '/api/sessions', params: { session: { status: 'active' } }, as: :json

      expect(response).to have_http_status(:created)
      expect(response.content_type).to include('application/json')
      json_response = JSON.parse(response.body)
      expect(json_response['status']).to eq('active')
      expect(json_response).to have_key('id')
      expect(json_response).to have_key('created_at')
      expect(json_response).to have_key('tasks')
    end

    it 'creates a session with completed status' do
      post '/api/sessions', params: { session: { status: 'completed' } }, as: :json

      expect(response).to have_http_status(:created)
      json_response = JSON.parse(response.body)
      expect(json_response['status']).to eq('completed')
    end

    it 'defaults to active status when not specified' do
      post '/api/sessions', params: { session: {} }, as: :json

      expect(response).to have_http_status(:created)
      json_response = JSON.parse(response.body)
      expect(json_response['status']).to eq('active')
    end

    it 'returns validation errors on invalid params' do
      post '/api/sessions', params: { session: { status: 'invalid_status' } }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      json_response = JSON.parse(response.body)
      expect(json_response).to have_key('errors')
    end
  end

  describe 'GET /api/sessions/:id' do
    let(:session) { create(:session) }

    it 'returns a session with its tasks' do
      create(:task, session: session, name: 'Task 1')
      create(:task, session: session, name: 'Task 2')

      get "/api/sessions/#{session.id}"

      expect(response).to have_http_status(:ok)
      json_response = JSON.parse(response.body)
      expect(json_response['id']).to eq(session.id)
      expect(json_response['status']).to eq('active')
      expect(json_response['tasks'].length).to eq(2)
      expect(json_response['tasks'].map { |t| t['name'] }).to include('Task 1', 'Task 2')
    end

    it 'returns 404 for non-existent session' do
      get '/api/sessions/999999'

      expect(response).to have_http_status(:not_found)
      json_response = JSON.parse(response.body)
      expect(json_response).to have_key('error')
    end
  end

  describe 'PATCH /api/sessions/:id' do
    let(:session) { create(:session, status: :active) }

    it 'updates session status' do
      patch "/api/sessions/#{session.id}", params: { session: { status: 'completed' } }, as: :json

      expect(response).to have_http_status(:ok)
      json_response = JSON.parse(response.body)
      expect(json_response['status']).to eq('completed')
    end

    it 'returns 404 for non-existent session' do
      patch '/api/sessions/999999', params: { session: { status: 'completed' } }, as: :json

      expect(response).to have_http_status(:not_found)
    end
  end

  describe 'DELETE /api/sessions/:id' do
    let(:session) { create(:session) }

    it 'deletes a session and its tasks' do
      task = create(:task, session: session)
      session_id = session.id

      delete "/api/sessions/#{session_id}"

      expect(response).to have_http_status(:no_content)
      expect(Session.exists?(session_id)).to be_falsy
      expect(Task.exists?(task.id)).to be_falsy
    end

    it 'returns 404 for non-existent session' do
      delete '/api/sessions/999999'

      expect(response).to have_http_status(:not_found)
    end
  end
end
