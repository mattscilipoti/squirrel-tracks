# frozen_string_literal: true

module Api
  class SessionsController < ApplicationController
    before_action :set_session, only: %i[show update destroy]

    # GET /api/sessions
    def index
      @sessions = Session.all
      render json: @sessions, each_serializer: SessionSerializer
    end

    # GET /api/sessions/:id
    def show
      render json: @session, serializer: SessionSerializer
    end

    # POST /api/sessions
    def create
      @session = Session.new(session_params)

      if @session.save
        render json: @session, serializer: SessionSerializer, status: :created
      else
        render json: { errors: @session.errors.full_messages }, status: :unprocessable_entity
      end
    rescue ArgumentError => e
      render json: { errors: [e.message] }, status: :unprocessable_entity
    end

    # PATCH/PUT /api/sessions/:id
    def update
      if @session.update(session_params)
        render json: @session, serializer: SessionSerializer
      else
        render json: { errors: @session.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # DELETE /api/sessions/:id
    def destroy
      @session.destroy
      head :no_content
    end

    private

    def set_session
      @session = Session.find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: { error: 'Session not found' }, status: :not_found
    end

    def session_params
      params.fetch(:session, {}).permit(:status)
    end
  end
end
