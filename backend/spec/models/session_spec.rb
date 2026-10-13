require 'rails_helper'

RSpec.describe Session, type: :model do
  describe 'associations' do
    it { is_expected.to have_many(:tasks).dependent(:destroy) }
  end

  describe 'enums' do
    it { is_expected.to define_enum_for(:status).with_values(active: 0, completed: 1) }
  end

  describe 'validations' do
    it { is_expected.to validate_presence_of(:status) }
  end

  describe '#create' do
    it 'creates a session with default active status' do
      session = create(:session)
      expect(session.status).to eq('active')
      expect(session).to be_persisted
    end

    it 'allows both active and completed statuses' do
      active_session = create(:session, status: :active)
      completed_session = create(:session, status: :completed)
      
      expect(active_session.status).to eq('active')
      expect(completed_session.status).to eq('completed')
    end
  end

  describe 'associations' do
    it 'can have many tasks' do
      session = create(:session)
      task1 = create(:task, session: session)
      task2 = create(:task, session: session)
      
      expect(session.tasks.count).to eq(2)
      expect(session.tasks).to include(task1, task2)
    end

    it 'destroys associated tasks when session is deleted' do
      session = create(:session)
      task = create(:task, session: session)
      session_id = session.id
      
      session.destroy
      
      expect(Task.where(session_id: session_id)).to be_empty
    end
  end
end
