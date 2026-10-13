# frozen_string_literal: true

module Api
  class TasksController < ApplicationController
    before_action :set_session
    before_action :set_task, only: %i[update destroy]

    # POST /api/sessions/:session_id/tasks
    def create
      @task = @session.tasks.build(task_params)

      if @task.save
        render json: @task, serializer: TaskSerializer, status: :created
      else
        render json: { errors: @task.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # PATCH/PUT /api/sessions/:session_id/tasks/:id
    def update
      if @task.update(task_params)
        render json: @task, serializer: TaskSerializer
      else
        render json: { errors: @task.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # DELETE /api/sessions/:session_id/tasks/:id
    def destroy
      @task.destroy
      head :no_content
    end

    private

    def set_session
      @session = Session.find(params[:session_id])
    rescue ActiveRecord::RecordNotFound
      render json: { error: 'Session not found' }, status: :not_found
    end

    def set_task
      @task = @session.tasks.find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: { error: 'Task not found' }, status: :not_found
    end

    def task_params
      params.require(:task).permit(:name, :duration_minutes)
    end
  end
end
